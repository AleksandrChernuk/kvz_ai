#!/usr/bin/env bash
# Незалежний watchdog: звільняє задачі, завислі (locked > timeout_minutes)
# через мертвий/впалий воркер. Призначений для запуску ПЛАНУВАЛЬНИКОМ ОС
# (launchd/cron), а НЕ з циклу poll.sh — так одноразовий воркер, що впав
# посеред задачі, все одно звільняється, навіть якщо ніхто його не рестартує.
#
# Використання:
#   ./watchdog.sh                     # разовий виклик (те, що й планувальник запускає)
#
# Env (agent/.env, той самий файл, що й у poll.sh):
#   API_URL, WORKER_TOKEN обовʼязкові. WATCHDOG_TIMEOUT_MINUTES (default 5).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/../.env"
  set +a
fi

: "${API_URL:?API_URL обовʼязковий}"
: "${WORKER_TOKEN:?WORKER_TOKEN обовʼязковий}"
TIMEOUT_MIN="${WATCHDOG_TIMEOUT_MINUTES:-5}"

curl -sf -X POST "$API_URL/api/tasks/watchdog" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 30 \
  -d "$(printf '{"timeout_minutes":%s}' "$TIMEOUT_MIN")"
echo
