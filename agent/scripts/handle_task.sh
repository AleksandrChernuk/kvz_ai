#!/usr/bin/env bash
# LLM-обробник задачі: читає TaskPayload з stdin, повертає TaskResult у stdout.
# RAG-grounding: дістає фрагменти з рольових бібліотек kb-docs і відповідає
# на їх основі; інакше — звичайна відповідь через Anthropic.
#
# Env:
#   ANTHROPIC_API_KEY — обовʼязковий
#   CLAUDE_MODEL      — default claude-opus-4-8
#   KB_QUERY_JS       — шлях до retrieval CLI конектора (default: репо/connectors/...)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY обовʼязковий}"
MODEL="${CLAUDE_MODEL:-claude-opus-4-8}"
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

# Історія: тільки user/assistant, без початкових assistant-повідомлень
# (перше повідомлення в API має бути user).
MESSAGES=$(echo "$PAYLOAD" | jq '
  def drop_leading_assistant:
    if length > 0 and .[0].role == "assistant" then .[1:] | drop_leading_assistant else . end;
  ([(.thread_context // [])[]
    | select(.role == "user" or .role == "assistant")
    | {role, content}] | drop_leading_assistant)
  + [{role: "user", content: .user_message}]')

BODY=$(jq -n \
  --arg model "$MODEL" \
  --arg system "$SYSTEM" \
  --argjson messages "$MESSAGES" \
  '{
    model: $model,
    max_tokens: 16000,
    thinking: {type: "adaptive"},
    system: $system,
    messages: $messages
  }')

RESP_FILE=$(mktemp)
trap 'rm -f "$RESP_FILE"' EXIT

# До 3 спроб з backoff на 429/5xx/529
HTTP_CODE=000
for attempt in 1 2 3; do
  HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
    https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    --max-time 300 \
    -d "$BODY")
  case "$HTTP_CODE" in
    200) break ;;
    429|500|529)
      echo "attempt $attempt: HTTP $HTTP_CODE, retry…" >&2
      sleep $((attempt * 10))
      ;;
    *)
      echo "HTTP $HTTP_CODE: $(cat "$RESP_FILE")" >&2
      exit 1
      ;;
  esac
done

if [ "$HTTP_CODE" != "200" ]; then
  echo "усі спроби вичерпано (HTTP $HTTP_CODE)" >&2
  exit 1
fi

ANSWER=$(jq -r '[.content[] | select(.type == "text") | .text] | join("\n\n")' "$RESP_FILE")
if [ -z "$ANSWER" ]; then
  echo "порожня відповідь моделі: $(cat "$RESP_FILE")" >&2
  exit 1
fi

IN_TOK=$(jq '.usage.input_tokens // 0' "$RESP_FILE")
OUT_TOK=$(jq '.usage.output_tokens // 0' "$RESP_FILE")

if [ "$GROUNDED" = "true" ]; then
  STEPS=$(jq -c -n --argjson s "$SOURCES" \
    '["Відповідь сформовано з бази знань (RAG)", ("Джерела: " + ($s | join(", ")))]')
  AGENT="kb"
else
  STEPS=$(jq -c -n --arg m "$MODEL" '["Запит оброблено через Anthropic API (" + $m + ")"]')
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
