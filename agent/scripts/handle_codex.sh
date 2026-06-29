#!/usr/bin/env bash
# Codex executor (виконавець) — універсальний read-only помічник КВЗ.
# Працює через Codex CLI під ПІДПИСКОЮ (`codex login`), без OPENAI_API_KEY.
# Read-only sandbox: Codex нічого не запускає і не змінює в системі.
#
# stdin: TaskPayload (JSON)   stdout: TaskResult (JSON)
# Env: CODEX_MODEL (опц.), KB_QUERY_JS (retrieval CLI конектора)
set -euo pipefail

command -v codex >/dev/null || { echo "потрібен залогінений codex CLI (підписка)" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KB_QUERY_JS="${KB_QUERY_JS:-$SCRIPT_DIR/../../connectors/kb-docs/dist/query-cli.js}"

PAYLOAD=$(cat)
USER_ROLE=$(echo "$PAYLOAD" | jq -r '.user_role // "viewer"')
USER_MESSAGE=$(echo "$PAYLOAD" | jq -r '.user_message // ""')
AVAILABLE_KBS=$(echo "$PAYLOAD" | jq -c '.available_knowledge_bases // []')
[ -n "$USER_MESSAGE" ] || { echo "порожнє повідомлення" >&2; exit 1; }

# --- RAG retrieval (role-scoped libraries) ----------------------------------
KB_LIBS=$(echo "$AVAILABLE_KBS" | jq -r '.[] | select(.mcp_server == "kb-docs") | .library | select(. != null and . != "")' | sort -u)
HITS='[]'
if [ -n "$KB_LIBS" ] && [ -n "$USER_MESSAGE" ] && [ -f "$KB_QUERY_JS" ] && command -v node >/dev/null; then
  while IFS= read -r lib; do
    [ -z "$lib" ] && continue
    out=$(node "$KB_QUERY_JS" --query "$USER_MESSAGE" --library "$lib" --limit 4 2>/dev/null || echo '')
    libhits=$(echo "$out" | jq -c '(.data.hits // []) | sort_by(-.score) | .[0:2]' 2>/dev/null || echo '[]')
    HITS=$(jq -c -n --argjson a "$HITS" --argjson b "$libhits" '$a + $b')
  done <<< "$KB_LIBS"
fi
TOPHITS=$(echo "$HITS" | jq -c 'sort_by(-.score) | .[0:5]')
GROUNDED=$(echo "$TOPHITS" | jq 'length > 0')
SOURCES='[]'

INSTR="Ти — read-only помічник внутрішньої системи КВЗ для PM, звітів, підбору \
релевантної бази знань/MCP, Bitrix24, 1С та операційних питань виробництва. \
Фокус не на написанні програмного коду: не створюй код і файли як основний результат, \
якщо користувач прямо не просить технічну консультацію. Допомагай сформувати запит, \
пояснити дані, підготувати чернетку звіту або план дій. \
Роль користувача: $USER_ROLE. Нічого не запускай, не змінюй у системі, не записуй у \
Bitrix24/1С і не обіцяй зовнішні дії. Для ролі viewer — тільки довідка."

if [ "$GROUNDED" = "true" ]; then
  CONTEXT=$(echo "$TOPHITS" | jq -r '.[] | "[\(.library)/\(.docId)] \(.title)\n\(.snippet)\n"')
  SOURCES=$(echo "$TOPHITS" | jq -c '[.[] | "\(.library)/\(.docId)"] | unique')
  INSTR="$INSTR

ФРАГМЕНТИ БАЗИ ЗНАНЬ. Відповідай ЛИШЕ на їх основі, став посилання у форматі \
[бібліотека/документ]. Якщо відповіді в них немає — чесно скажи, не вигадуй:
$CONTEXT"
else
  KB_NAMES=$(echo "$AVAILABLE_KBS" | jq -r '[.[] | .name] | join(", ")')
  if [ -n "$KB_NAMES" ]; then
    INSTR="$INSTR

Доступні бази знань для ролі: $KB_NAMES. Якщо потрібного факту немає в контексті, \
порадь, яку базу/MCP варто підключити або уточнити."
  fi
fi

PROMPT=$(echo "$PAYLOAD" | jq -r --arg instr "$INSTR" '
  ([(.thread_context // [])[]
    | select(.role == "user" or .role == "assistant")
    | "\(.role | ascii_upcase): \(.content)"] | join("\n\n")) as $hist
  | $instr
    + "\n\n"
    + (if ($hist | length) > 0 then "КОНТЕКСТ ЧАТУ:\n" + $hist + "\n\n" else "" end)
    + "ЗАДАЧА: " + .user_message')

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

if [ "$GROUNDED" = "true" ]; then
  STEPS=$(jq -c -n --argjson s "$SOURCES" \
    '["Відповідь Codex з бази знань (RAG)", ("Джерела: " + ($s | join(", ")))]')
else
  STEPS='["Виконано Codex CLI / read-only"]'
fi

jq -n \
  --arg answer "$ANSWER" \
  --argjson steps "$STEPS" \
  --argjson sources "$SOURCES" \
  '{answer: $answer, agent_used: "codex", steps: $steps, sources: $sources, tokens: {input: 0, output: 0}}'
