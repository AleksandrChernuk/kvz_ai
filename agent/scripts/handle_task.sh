#!/usr/bin/env bash
# LLM-обробник задачі: читає TaskPayload з stdin, повертає TaskResult у stdout.
# Працює через Claude Code CLI (`claude -p`) під ПІДПИСКОЮ — без ANTHROPIC_API_KEY
# і без оплати за токени. RAG-grounding: дістає фрагменти з рольових бібліотек
# kb-docs і відповідає на їх основі.
#
# Передумова: на хості воркера встановлений і залогінений `claude` CLI
# (`claude login` під вашою підпискою). Жодних API-ключів.
#
# Env:
#   CLAUDE_MODEL — алиас або повний id моделі (default: opus)
#   KB_QUERY_JS  — шлях до retrieval CLI конектора (default: репо/connectors/...)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v claude >/dev/null || { echo "потрібен залогінений claude CLI (підписка)" >&2; exit 1; }
MODEL="${CLAUDE_MODEL:-opus}"
KB_QUERY_JS="${KB_QUERY_JS:-$SCRIPT_DIR/../../connectors/kb-docs/dist/query-cli.js}"

PAYLOAD=$(cat)

USER_ROLE=$(echo "$PAYLOAD" | jq -r '.user_role // "viewer"')
USER_MESSAGE=$(echo "$PAYLOAD" | jq -r '.user_message // ""')
AVAILABLE_AGENTS=$(echo "$PAYLOAD" | jq -c '.available_agents // []')
AVAILABLE_KBS=$(echo "$PAYLOAD" | jq -c '.available_knowledge_bases // []')

# --- RAG retrieval ----------------------------------------------------------
# Бібліотеки kb-docs, доступні цій ролі (доступ уже відфільтрований воркером).
# Рядки без mcp_config.library ПРОПУСКАЄМО — не розширюємо пошук (інакше роль
# могла б дістати неконфігуровану бібліотеку повністю).
KB_LIBS=$(echo "$AVAILABLE_KBS" | jq -r '.[] | select(.mcp_server == "kb-docs") | .library | select(. != null and . != "")' | sort -u)
HITS='[]'
if [ -n "$KB_LIBS" ] && [ -n "$USER_MESSAGE" ] && [ -f "$KB_QUERY_JS" ] && command -v node >/dev/null; then
  while IFS= read -r lib; do
    [ -z "$lib" ] && continue
    out=$(node "$KB_QUERY_JS" --query "$USER_MESSAGE" --library "$lib" --limit 4 2>/dev/null || echo '')
    # top-2 на бібліотеку перед злиттям: BM25-оцінки НЕ порівнянні між
    # бібліотеками (idf рахується в межах кожної), тож обмежуємо внесок кожної.
    libhits=$(echo "$out" | jq -c '(.data.hits // []) | sort_by(-.score) | .[0:2]' 2>/dev/null || echo '[]')
    HITS=$(jq -c -n --argjson a "$HITS" --argjson b "$libhits" '$a + $b')
  done <<< "$KB_LIBS"
fi
TOPHITS=$(echo "$HITS" | jq -c 'sort_by(-.score) | .[0:5]')
GROUNDED=$(echo "$TOPHITS" | jq 'length > 0')

SYSTEM="Ти — асистент внутрішньої системи КВЗ. Відповідай українською, стисло і по суті. \
Роль користувача: $USER_ROLE. \
Доступні для цієї ролі агенти: $AVAILABLE_AGENTS. \
Доступні для цієї ролі бази знань/MCP-сервіси: $AVAILABLE_KBS. \
Для ролі viewer — тільки довідкові відповіді, жодних інструкцій зі зміни даних чи виконання коду. \
Якщо для точної відповіді бракує даних (немає доступу до баз знань) — чесно скажи про це."

if [ "$GROUNDED" = "true" ]; then
  CONTEXT=$(echo "$TOPHITS" | jq -r '.[] | "[\(.library)/\(.docId)] \(.title)\n\(.snippet)\n"')
  SOURCES=$(echo "$TOPHITS" | jq -c '[.[] | "\(.library)/\(.docId)"] | unique')
  SYSTEM="$SYSTEM

ФРАГМЕНТИ БАЗИ ЗНАНЬ. Відповідай ЛИШЕ на їх основі, став посилання у форматі [бібліотека/документ]. Якщо відповіді в них немає — чесно скажи, не вигадуй:
$CONTEXT"
fi

# Промпт: компактна історія розмови + поточне питання. Token gate уже обрізав
# контекст до ліміту. `claude -p` бере один промпт; система йде окремо.
PROMPT=$(echo "$PAYLOAD" | jq -r '
  ([(.thread_context // [])[]
    | select(.role == "user" or .role == "assistant")
    | "\(.role | ascii_upcase): \(.content)"] | join("\n\n")) as $hist
  | (if ($hist | length) > 0 then $hist + "\n\n" else "" end)
    + "ПИТАННЯ: " + .user_message')

RESP_FILE=$(mktemp)
trap 'rm -f "$RESP_FILE"' EXIT

# Виклик через підписку (без API-ключа). --allowed-tools "" — жодних інструментів,
# лише відповідь. JSON-вивід містить .result і .usage.
set +e
printf '%s' "$PROMPT" | claude -p \
  --model "$MODEL" \
  --append-system-prompt "$SYSTEM" \
  --output-format json \
  --allowed-tools "" \
  > "$RESP_FILE" 2>>/tmp/kvz-claude.log
CLAUDE_RC=$?
set -e

if [ "$CLAUDE_RC" -ne 0 ]; then
  echo "claude CLI rc=$CLAUDE_RC (див. /tmp/kvz-claude.log)" >&2
  exit 1
fi

if [ "$(jq -r '.is_error // false' "$RESP_FILE" 2>/dev/null)" = "true" ]; then
  echo "claude повернув is_error: $(cat "$RESP_FILE")" >&2
  exit 1
fi

ANSWER=$(jq -r '.result // empty' "$RESP_FILE")
if [ -z "$ANSWER" ]; then
  echo "порожня відповідь claude: $(cat "$RESP_FILE")" >&2
  exit 1
fi

IN_TOK=$(jq '.usage.input_tokens // 0' "$RESP_FILE")
OUT_TOK=$(jq '.usage.output_tokens // 0' "$RESP_FILE")

if [ "$GROUNDED" = "true" ]; then
  STEPS=$(jq -c -n --argjson s "$SOURCES" \
    '["Відповідь сформовано з бази знань (RAG)", ("Джерела: " + ($s | join(", ")))]')
  AGENT="kb"
else
  STEPS=$(jq -c -n --arg m "$MODEL" '["Оброблено через Claude CLI / підписка (" + $m + ")"]')
  AGENT="codex"
fi

jq -n \
  --arg answer "$ANSWER" \
  --arg agent "$AGENT" \
  --argjson steps "$STEPS" \
  --argjson input "$IN_TOK" \
  --argjson output "$OUT_TOK" \
  '{
    answer: $answer,
    agent_used: $agent,
    steps: $steps,
    tokens: {input: $input, output: $output}
  }'
