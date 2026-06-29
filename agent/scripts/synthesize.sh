#!/usr/bin/env bash
# Крок SYNTHESIZE (МОЗОК = Claude). Зводить результати під-задач у ОДНУ
# обґрунтовану відповідь українською. Нічого не вигадує поза під-результатами.
#
# stdin: JSON {
#   "user_message": "<оригінальний запит>",
#   "sub_results": [ {"id":"s1","executor":"codex","status":"ok|failed",
#                     "answer":"...","sources":["lib/doc"]}, ... ]
# }
# stdout: текст синтезованої відповіді (звичайний рядок).
#
# Усе під ПІДПИСКОЮ (`claude login`), без API-ключів. Fail-soft: якщо синтез
# недоступний — rc=1, викликач робить детермінований fallback (склеює під-відповіді).
#
# Env: CLAUDE_MODEL (default opus)
set -euo pipefail

CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"
STEP_TIMEOUT="${ORCH_STEP_TIMEOUT:-90}"

with_timeout() { # $1=сек, далі команда (no-op, якщо timeout відсутній)
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 5 "$secs" "$@"; else "$@"; fi
}

INPUT=$(cat)
USER_MESSAGE=$(printf '%s' "$INPUT" | jq -r '.user_message // ""')
[ -n "$USER_MESSAGE" ] || exit 1
command -v claude >/dev/null || exit 1

# Складаємо контекст із під-результатів (id, виконавець, статус, відповідь, джерела).
SUBCTX=$(printf '%s' "$INPUT" | jq -r '
  (.sub_results // [])[]
  | "### Крок \(.id) (\(.executor), \(.status))\n"
    + (.answer // "(немає відповіді)")
    + (if (.sources // []) | length > 0 then "\nДжерела: " + ((.sources) | join(", ")) else "" end)
    + "\n"')

SYNTH_SYS="Ти — синтезатор відповідей інженерної системи КВЗ. Тобі дають оригінальний \
запит і результати кількох під-задач. Зведи їх в ОДНУ цілісну відповідь українською: \
стисло, по суті, у логічному порядку. Використовуй ЛИШЕ надані під-результати — нічого \
не додавай від себе й не вигадуй чисел. Зберігай посилання на базу знань у форматі \
[бібліотека/документ], якщо вони були. Якщо якийсь крок провалився — чесно зазнач це."

PROMPT="ОРИГІНАЛЬНИЙ ЗАПИТ: $USER_MESSAGE

РЕЗУЛЬТАТИ ПІД-ЗАДАЧ:
$SUBCTX"

RESP_FILE=$(mktemp); trap 'rm -f "$RESP_FILE"' EXIT
set +e
printf '%s' "$PROMPT" | with_timeout "$STEP_TIMEOUT" claude -p \
  --model "$CLAUDE_MODEL" \
  --append-system-prompt "$SYNTH_SYS" \
  --output-format json \
  --allowed-tools "" \
  > "$RESP_FILE" 2>>/tmp/kvz-synth.log
CRC=$?
set -e

[ "$CRC" -eq 0 ] || exit 1
[ "$(jq -r '.is_error // false' "$RESP_FILE" 2>/dev/null)" != "true" ] || exit 1
ANSWER=$(jq -r '.result // empty' "$RESP_FILE")
[ -n "$ANSWER" ] || exit 1

printf '%s' "$ANSWER"
