#!/usr/bin/env bash
# Воркер черги kvz-ai: claim → token gate → handler → complete/fail.
#
# Використання:
#   ./poll.sh           # нескінченний цикл
#   ./poll.sh --once    # одна ітерація (для cron / тестування)
#
# Env (можна покласти в agent/.env):
#   API_URL        — база Next.js, напр. https://kvz-ai.vercel.app
#   WORKER_TOKEN   — shared secret (той самий, що в .env.local веб-сервера)
#   POLL_INTERVAL  — пауза між ітераціями, сек (default 5)
#   TOKEN_LIMIT    — ліміт токенів на задачу (default 5000)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Підвантажуємо agent/.env якщо є
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/../.env"
  set +a
fi

: "${API_URL:?API_URL обовʼязковий (напр. https://kvz-ai.vercel.app)}"
: "${WORKER_TOKEN:?WORKER_TOKEN обовʼязковий}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
TOKEN_LIMIT="${TOKEN_LIMIT:-5000}"
HANDLER="${HANDLER:-$SCRIPT_DIR/handle_task.sh}"

for dep in curl jq python3; do
  command -v "$dep" >/dev/null || { echo "Потрібен $dep" >&2; exit 1; }
done

WORKER_ID="orch-$(date +%s)-$RANDOM"
RUNNING=1
trap 'RUNNING=0; echo "[$WORKER_ID] зупинка…" >&2' INT TERM

log() { echo "[$(date '+%H:%M:%S')] [$WORKER_ID] $*" >&2; }

# POST на API з worker-токеном. $1 = шлях, $2 = JSON body.
api() {
  curl -sf -X POST "$API_URL$1" \
    -H "Authorization: Bearer $WORKER_TOKEN" \
    -H "Content-Type: application/json" \
    --max-time 30 \
    -d "$2"
}

fail_task() { # $1=task_id $2=error $3=retry(true|false)
  api /api/tasks/fail "$(jq -n --arg id "$1" --arg w "$WORKER_ID" --arg e "$2" --argjson r "$3" \
    '{task_id: $id, worker_id: $w, error: $e, retry: $r}')" >/dev/null || true
}

checkpoint() { # $1=task_id $2=progress $3=pending
  api /api/tasks/checkpoint "$(jq -n --arg id "$1" --arg w "$WORKER_ID" --arg p "$2" --arg n "$3" \
    '{task_id: $id, worker_id: $w, checkpoint: {progress_summary: $p, pending_work: $n, agent_session_id: null}}')" \
    >/dev/null || true
}

request_approval() { # $1=task_id $2=result(json)
  api /api/tasks/request-approval "$(jq -n --arg id "$1" --arg w "$WORKER_ID" --argjson r "$2" \
    '{task_id: $id, worker_id: $w, result: $r}')" >/dev/null
}

process_one() {
  local claim task task_id payload trimmed gate_rc result approved_at

  claim=$(api /api/tasks/claim "$(jq -n --arg w "$WORKER_ID" '{worker_id: $w}')") || {
    log "claim недоступний (API/мережа)"; return 1
  }
  task=$(echo "$claim" | jq '.task')
  if [ "$task" = "null" ]; then
    return 1  # черга порожня
  fi

  task_id=$(echo "$task" | jq -r '.id')
  payload=$(echo "$task" | jq '.payload')
  approved_at=$(echo "$task" | jq -r '.approved_at // empty')
  log "задача $task_id"

  # Token gate: обрізаємо контекст до ліміту; якщо саме повідомлення
  # завелике — остаточний fail без retry.
  set +e
  trimmed=$(echo "$payload" | python3 "$SCRIPT_DIR/check_token_limit.py" --trim --limit "$TOKEN_LIMIT" 2>/dev/null)
  gate_rc=$?
  set -e
  if [ $gate_rc -eq 1 ]; then
    log "задача $task_id: перевищено ліміт $TOKEN_LIMIT токенів"
    fail_task "$task_id" "Повідомлення занадто довге (ліміт $TOKEN_LIMIT токенів)" false
    return 0
  elif [ $gate_rc -ne 0 ]; then
    log "задача $task_id: некоректний payload"
    fail_task "$task_id" "Некоректний payload задачі" false
    return 0
  fi

  checkpoint "$task_id" "Задачу захоплено, token gate пройдено" "Виклик LLM-обробника"

  set +e
  result=$(echo "$trimmed" | "$HANDLER" 2>>/tmp/kvz-worker-handler.log)
  local handler_rc=$?
  set -e
  if [ $handler_rc -ne 0 ] || [ -z "$result" ]; then
    log "задача $task_id: handler впав (rc=$handler_rc), повертаємо в чергу"
    fail_task "$task_id" "Помилка обробника (див. лог воркера)" true
    return 0
  fi

  # Детермінований фільтр (НЕ залежить від ШІ). Якщо handler додав
  # result.validation з полем kind — прогоняємо математичну/форматну перевірку.
  # Провал → на доробку з поясненням (retry), результат людині НЕ йде.
  local validation verdict reason
  validation=$(echo "$result" | jq -c '.validation // empty')
  if [ -n "$validation" ]; then
    set +e
    verdict=$(echo "$validation" | python3 "$SCRIPT_DIR/validate_result.py" 2>/dev/null)
    local val_rc=$?
    set -e
    if [ "$val_rc" -ne 0 ]; then
      reason=$(echo "$verdict" | jq -r '.reason // "не пройдено детермінованої перевірки"')
      log "задача $task_id: фільтр відхилив — $reason"
      fail_task "$task_id" "Детермінована перевірка: $reason" true
      return 0
    fi
    log "задача $task_id: детермінований фільтр пройдено"
  fi

  # Гейт людського підтвердження перед незворотною дією.
  # handler виставляє result.requires_approval=true для дій, що йдуть назовні
  # (ціна клієнту, .dxf на верстат, оплата). Якщо задача вже підтверджена
  # (approved_at не порожній) — гейт пройдено, виконуємо й завершуємо.
  local needs_approval
  needs_approval=$(echo "$result" | jq -r '.requires_approval // false')
  if [ "$needs_approval" = "true" ] && [ -z "$approved_at" ]; then
    if request_approval "$task_id" "$result"; then
      log "задача $task_id: очікує підтвердження людини"
    else
      log "задача $task_id: не вдалося поставити на підтвердження"
      fail_task "$task_id" "Не вдалося поставити на підтвердження" true
    fi
    return 0
  fi

  local agent
  agent=$(echo "$result" | jq -r '.agent_used // "codex"')
  api /api/tasks/complete "$(jq -n --arg id "$task_id" --arg w "$WORKER_ID" --arg a "$agent" --argjson r "$result" \
    '{task_id: $id, worker_id: $w, result: $r, agent: $a}')" >/dev/null || {
    log "задача $task_id: complete не пройшов"
    return 0
  }
  log "задача $task_id: готово"
  return 0
}

log "старт, API: $API_URL"
iteration=0
while [ "$RUNNING" = "1" ]; do
  iteration=$((iteration + 1))

  # Кожні 10 ітерацій — звільняємо завислі задачі інших воркерів
  if [ $((iteration % 10)) -eq 0 ]; then
    api /api/tasks/watchdog '{"timeout_minutes": 5}' >/dev/null || true
  fi

  if process_one; then
    # задача оброблена — одразу пробуємо наступну
    continue
  fi

  if [ "${1:-}" = "--once" ]; then
    break
  fi
  sleep "$POLL_INTERVAL"
done
log "зупинено"
