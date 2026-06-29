#!/usr/bin/env bash
# Codex executor (виконавець) — для технічних задач (код, скрипти, розрахунки).
# Працює через Codex CLI під ПІДПИСКОЮ (`codex login`), без OPENAI_API_KEY.
# Read-only sandbox: Codex нічого не запускає і не змінює в системі.
#
# stdin: TaskPayload (JSON)   stdout: TaskResult (JSON)
# Env: CODEX_MODEL (опц.)
set -euo pipefail

command -v codex >/dev/null || { echo "потрібен залогінений codex CLI (підписка)" >&2; exit 1; }

PAYLOAD=$(cat)
USER_ROLE=$(echo "$PAYLOAD" | jq -r '.user_role // "viewer"')
USER_MESSAGE=$(echo "$PAYLOAD" | jq -r '.user_message // ""')
[ -n "$USER_MESSAGE" ] || { echo "порожнє повідомлення" >&2; exit 1; }

INSTR="Ти — технічний виконавець внутрішньої системи КВЗ. Виконай задачу і дай стислий результат українською. \
Роль користувача: $USER_ROLE. Лише читання/генерація — нічого не запускай і не змінюй у системі. \
Для ролі viewer — тільки довідка, жодних дій."

PROMPT="$INSTR

ЗАДАЧА: $USER_MESSAGE"

OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
MODEL_ARG=()
[ -n "${CODEX_MODEL:-}" ] && MODEL_ARG=(-m "$CODEX_MODEL")

# --sandbox read-only: модель не виконує команд; -o кладе фінальну відповідь у файл.
# Безпечне розгортання порожнього масиву під set -u (bash 3.2 на macOS).
set +e
codex exec "$PROMPT" ${MODEL_ARG[@]+"${MODEL_ARG[@]}"} --sandbox read-only -o "$OUT" \
  >>/tmp/kvz-codex.log 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || { echo "codex rc=$RC (див. /tmp/kvz-codex.log)" >&2; exit 1; }

ANSWER=$(cat "$OUT")
[ -n "$ANSWER" ] || { echo "порожня відповідь codex" >&2; exit 1; }

jq -n --arg answer "$ANSWER" \
  '{answer: $answer, agent_used: "codex", steps: ["Виконано Codex CLI / підписка"], tokens: {input: 0, output: 0}}'
