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

api_get() {
  curl -sf "$API_URL$1" \
    -H "Authorization: Bearer $WORKER_TOKEN" \
    --max-time 30
}

fail_task() { # $1=task_id $2=error $3=retry(true|false)
  api /api/tasks/fail "$(jq -n --arg id "$1" --arg w "$WORKER_ID" --arg e "$2" --argjson r "$3" \
    '{task_id: $id, worker_id: $w, error: $e, retry: $r}')" >/dev/null || true
}

complete_task() { # $1=task_id $2=result(json)
  local agent
  agent=$(echo "$2" | jq -r '.agent_used // "codex"')
  api /api/tasks/complete "$(jq -n --arg id "$1" --arg w "$WORKER_ID" --arg a "$agent" --argjson r "$2" \
    '{task_id: $id, worker_id: $w, result: $r, agent: $a}')" >/dev/null
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
  local claim task task_id payload trimmed gate_rc result approved_at approved_result
  local user_role agents_payload kbs_payload agents_rc kbs_rc allowed_agents allowed_kbs

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
  approved_result=$(echo "$task" | jq -c '.result // empty')
  log "задача $task_id"

  checkpoint "$task_id" "Задачу захоплено воркером" "Перевіряю розмір контексту"

  local is_resume=0
  if [ -n "$approved_at" ]; then
    if [ -z "$approved_result" ] || [ "$approved_result" = "null" ]; then
      log "задача $task_id: підтверджена, але approved result відсутній"
      fail_task "$task_id" "Підтверджений результат відсутній" false
      return 0
    fi

    if ! echo "$approved_result" | jq -e '.answer | strings | length > 0' >/dev/null; then
      log "задача $task_id: підтверджений результат некоректний"
      fail_task "$task_id" "Підтверджений результат некоректний" false
      return 0
    fi

    # Orchestrated preview з планом → резюме: перезапускаємо handler з тим
    # самим погодженим планом, щоб притримані (held) кроки реально виконались
    # (не просто повторно доставити людині старий preview — там незворотна
    # дія ще НЕ була зроблена). Немає плану (не orchestrated) → нема що
    # резюмити, старий шлях: довіряємо preview як фінальному результату.
    local resume_plan resume_sub
    resume_plan=$(echo "$approved_result" | jq -c '.raw_result.plan // empty')
    resume_sub=$(echo "$approved_result" | jq -c '.raw_result.sub_results // empty')
    if [ "$(echo "$approved_result" | jq -r '.agent_used // empty')" = "orchestrated" ] \
       && [ -n "$resume_plan" ] && [ "$resume_plan" != "null" ]; then
      log "задача $task_id: резюмую після підтвердження (виконую притримані кроки)"
      is_resume=1
      payload=$(echo "$payload" | jq -c --argjson plan "$resume_plan" --argjson sub "${resume_sub:-[]}" \
        '. + {resume: {plan: $plan, sub_results: $sub}}')
      # Падаємо крізь звичайний конвеєр нижче (token gate → доступи → handler →
      # фільтр → approval-check → complete) з payload, що несе .resume.
    else
      if complete_task "$task_id" "$approved_result"; then
        log "задача $task_id: готово після підтвердження (без резюме — немає плану)"
      else
        log "задача $task_id: complete підтвердженого результату не пройшов"
        fail_task "$task_id" "Не вдалося завершити підтверджений результат" false
      fi
      return 0
    fi
  fi

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

  checkpoint "$task_id" "Контекст вміщується у ліміт" "Завантажую доступні агенти та бази знань"

  user_role=$(echo "$trimmed" | jq -r '.user_role // "viewer"')

  set +e
  agents_payload=$(api_get "/api/agents?role=$user_role")
  agents_rc=$?
  kbs_payload=$(api_get "/api/kb?role=$user_role")
  kbs_rc=$?
  set -e

  if [ "$agents_rc" -ne 0 ] || [ "$kbs_rc" -ne 0 ]; then
    log "задача $task_id: не вдалося отримати матрицю доступів для ролі $user_role"
    fail_task "$task_id" "Не вдалося отримати доступні агенти/сервіси" true
    return 0
  fi

  allowed_agents=$(echo "$agents_payload" | jq -c '[.agents[] | {key, name, description}]')
  allowed_kbs=$(echo "$kbs_payload" | jq -c '[.knowledge_bases[] | {id, name, description, mcp_server, library: (.mcp_config.library // null)}]')
  trimmed=$(echo "$trimmed" | jq -c \
    --argjson agents "$allowed_agents" \
    --argjson kbs "$allowed_kbs" \
    '. + {available_agents: $agents, available_knowledge_bases: $kbs}')

  checkpoint "$task_id" "Доступи завантажено" "Запускаю агента"

  set +e
  result=$(echo "$trimmed" | "$HANDLER" 2>>/tmp/kvz-worker-handler.log)
  local handler_rc=$?
  set -e
  if [ $handler_rc -ne 0 ] || [ -z "$result" ]; then
    log "задача $task_id: handler впав (rc=$handler_rc), повертаємо в чергу"
    fail_task "$task_id" "Помилка обробника (див. лог воркера)" true
    return 0
  fi

  checkpoint "$task_id" "Агент повернув відповідь" "Перевіряю результат"

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
    checkpoint "$task_id" "Виявлено незворотну дію" "Чекаю підтвердження людини"
    if request_approval "$task_id" "$result"; then
      log "задача $task_id: очікує підтвердження людини"
    else
      log "задача $task_id: не вдалося поставити на підтвердження"
      fail_task "$task_id" "Не вдалося поставити на підтвердження" true
    fi
    return 0
  fi

  # Резюме після підтвердження НЕ має право знову зупинитись на approval —
  # план уже погоджено людиною. Якщо handler повернув requires_approval=true
  # тут, це порушення інваріанту (бag у резюме-шляху), а не легітимний новий
  # гейт: не завершуємо мовчки з непідтвердженою незворотною дією всередині.
  if [ "$is_resume" = "1" ] && [ "$needs_approval" = "true" ]; then
    log "задача $task_id: резюме після підтвердження знову вимагає approval — ескалюю"
    fail_task "$task_id" "Резюме після підтвердження повторно зупинилось на approval (внутрішня помилка)" false
    return 0
  fi

  checkpoint "$task_id" "Перевірки пройдено" "Готую відповідь у чаті"

  complete_task "$task_id" "$result" || {
    log "задача $task_id: complete не пройшов"
    fail_task "$task_id" "Не вдалося завершити задачу: агент недоступний або complete відхилено" false
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
