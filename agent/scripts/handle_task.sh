#!/usr/bin/env bash
# LLM-обробник задачі: читає TaskPayload з stdin, повертає TaskResult у stdout.
# Викликає Anthropic Messages API через curl.
#
# Env:
#   ANTHROPIC_API_KEY — обовʼязковий
#   CLAUDE_MODEL      — default claude-opus-4-8
set -euo pipefail

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY обовʼязковий}"
MODEL="${CLAUDE_MODEL:-claude-opus-4-8}"

PAYLOAD=$(cat)

USER_ROLE=$(echo "$PAYLOAD" | jq -r '.user_role // "viewer"')

SYSTEM="Ти — асистент внутрішньої системи КВЗ. Відповідай українською, стисло і по суті. \
Роль користувача: $USER_ROLE. \
Для ролі viewer — тільки довідкові відповіді, жодних інструкцій зі зміни даних чи виконання коду. \
Якщо для точної відповіді бракує даних (немає доступу до баз знань) — чесно скажи про це."

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

jq -n \
  --arg answer "$ANSWER" \
  --arg model "$MODEL" \
  --argjson input "$IN_TOK" \
  --argjson output "$OUT_TOK" \
  '{
    answer: $answer,
    agent_used: "codex",
    steps: ["Запит оброблено через Anthropic API (\($model))"],
    tokens: {input: $input, output: $output}
  }'
