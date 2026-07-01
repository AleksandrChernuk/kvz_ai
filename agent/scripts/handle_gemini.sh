#!/usr/bin/env bash
# Connector executor (виконавець конекторів): RAG-grounding + відповідь з бази знань.
# Виконавець за замовчуванням — Gemini CLI під ПІДПИСКОЮ. Якщо gemini відсутній
# або впав — fail-soft на Claude CLI, щоб система працювала і без Gemini.
#
# stdin: TaskPayload (JSON)   stdout: TaskResult (JSON)
# Env: GEMINI_MODEL (опц.), CLAUDE_MODEL (fallback, default opus),
#      KB_QUERY_JS (retrieval CLI конектора)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KB_QUERY_JS="${KB_QUERY_JS:-$SCRIPT_DIR/../../connectors/kb-docs/dist/query-cli.js}"
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"

PAYLOAD=$(cat)
USER_ROLE=$(echo "$PAYLOAD" | jq -r '.user_role // "viewer"')
USER_MESSAGE=$(echo "$PAYLOAD" | jq -r '.user_message // ""')
AVAILABLE_AGENTS=$(echo "$PAYLOAD" | jq -c '.available_agents // []')
AVAILABLE_CONNECTORS=$(echo "$PAYLOAD" | jq -c '.available_connectors // .available_knowledge_bases // []')

# --- RAG retrieval (role-scoped libraries) ----------------------------------
KB_LIBS=$(echo "$AVAILABLE_CONNECTORS" | jq -r '.[] | select(.mcp_server == "kb-docs") | .library | select(. != null and . != "")' | sort -u)
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

SYSTEM="Ти — асистент внутрішньої системи КВЗ. Відповідай українською, стисло і по суті. \
Роль користувача: $USER_ROLE. \
Для ролі viewer — тільки довідкові відповіді, жодних інструкцій зі зміни даних чи виконання коду. \
Якщо для точної відповіді бракує даних (немає доступу до баз знань) — чесно скажи про це."

if [ "$GROUNDED" = "true" ]; then
  CONTEXT=$(echo "$TOPHITS" | jq -r '.[] | "[\(.library)/\(.docId)] \(.title)\n\(.snippet)\n"')
  SOURCES=$(echo "$TOPHITS" | jq -c '[.[] | "\(.library)/\(.docId)"] | unique')
  SYSTEM="$SYSTEM

ФРАГМЕНТИ БАЗИ ЗНАНЬ. Відповідай ЛИШЕ на їх основі, став посилання у форматі [бібліотека/документ]. Якщо відповіді в них немає — чесно скажи, не вигадуй:
$CONTEXT"
fi

PROMPT=$(echo "$PAYLOAD" | jq -r '
  ([(.thread_context // [])[]
    | select(.role == "user" or .role == "assistant")
    | "\(.role | ascii_upcase): \(.content)"] | join("\n\n")) as $hist
  | (if ($hist | length) > 0 then $hist + "\n\n" else "" end)
    + "ПИТАННЯ: " + .user_message')

ANSWER=""
MODEL_USED=""
IN_TOK=0
OUT_TOK=0

# --- Виконавець: Gemini (перевага) -------------------------------------------
# УВАГА: точні прапори gemini CLI слід звірити на хості воркера. Передаємо
# систему+промпт одним блоком через stdin; вивід — звичайний текст.
if command -v gemini >/dev/null; then
  set +e
  GEM=$(printf '%s\n\n%s' "$SYSTEM" "$PROMPT" \
    | gemini ${GEMINI_MODEL:+-m "$GEMINI_MODEL"} -p - 2>>/tmp/kvz-gemini.log)
  GRC=$?
  set -e
  if [ "$GRC" -eq 0 ] && [ -n "$GEM" ]; then
    ANSWER="$GEM"; MODEL_USED="gemini"
  else
    echo "gemini виконавець недоступний — fallback на claude" >&2
  fi
fi

# --- Fallback: Claude --------------------------------------------------------
if [ -z "$ANSWER" ] && command -v claude >/dev/null; then
  RESP_FILE=$(mktemp); trap 'rm -f "$RESP_FILE"' EXIT
  set +e
  printf '%s' "$PROMPT" | claude -p \
    --model "$CLAUDE_MODEL" \
    --append-system-prompt "$SYSTEM" \
    --output-format json \
    --allowed-tools "" \
    > "$RESP_FILE" 2>>/tmp/kvz-claude.log
  CRC=$?
  set -e
  if [ "$CRC" -eq 0 ] && [ "$(jq -r '.is_error // false' "$RESP_FILE" 2>/dev/null)" != "true" ]; then
    ANSWER=$(jq -r '.result // empty' "$RESP_FILE")
    IN_TOK=$(jq '.usage.input_tokens // 0' "$RESP_FILE")
    OUT_TOK=$(jq '.usage.output_tokens // 0' "$RESP_FILE")
    MODEL_USED="claude"
  fi
fi

if [ -z "$ANSWER" ]; then
  ANSWER="Зараз не можу сформувати відповідь: виконавець знань тимчасово недоступний або вичерпав ліміт сесії. Спробуйте ще раз трохи пізніше."
  MODEL_USED="unavailable"
fi

if [ "$GROUNDED" = "true" ]; then
  STEPS=$(jq -c -n --argjson s "$SOURCES" --arg m "$MODEL_USED" \
    '["Відповідь з бази знань (RAG, " + $m + ")", ("Джерела: " + ($s | join(", ")))]')
  AGENT="connector"
else
  STEPS=$(jq -c -n --arg m "$MODEL_USED" '["Оброблено виконавцем знань (" + $m + ")"]')
  SOURCES='[]'
  AGENT="connector"
fi

jq -n \
  --arg answer "$ANSWER" \
  --arg agent "$AGENT" \
  --argjson steps "$STEPS" \
  --argjson sources "$SOURCES" \
  --argjson input "$IN_TOK" \
  --argjson output "$OUT_TOK" \
  '{answer: $answer, agent_used: $agent, steps: $steps, sources: $sources, tokens: {input: $input, output: $output}}'
