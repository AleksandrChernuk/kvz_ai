#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/kvz-ai}"
APP_USER="${APP_USER:-kvzai}"
API_URL="${API_URL:-}"
WORKER_TOKEN="${WORKER_TOKEN:-}"
REMOTE="${SERVER:-}"

if [[ -n "$REMOTE" ]]; then
  script_path="$APP_ROOT/current/ops/deploy/smoke-check.sh"
  ssh "$REMOTE" "sudo APP_ROOT='$APP_ROOT' APP_USER='$APP_USER' '$script_path'"
  exit 0
fi

failures=0

info() { printf '[smoke] %s\n' "$*"; }
pass() { printf '[smoke] ok: %s\n' "$*"; }
fail() {
  printf '[smoke] FAIL: %s\n' "$*" >&2
  failures=$((failures + 1))
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

check_file() {
  [[ -e "$1" ]] && pass "$1 exists" || fail "$1 missing"
}

check_systemd_active() {
  local unit="$1"
  if systemctl is-active --quiet "$unit"; then
    pass "$unit active"
  else
    fail "$unit not active"
    systemctl --no-pager --full status "$unit" | sed -n '1,16p' >&2 || true
  fi
}

load_env() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  else
    fail "$env_file missing"
  fi
}

http_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ "$method" == "GET" ]]; then
    curl -fsS "$API_URL$path" \
      -H "Authorization: Bearer $WORKER_TOKEN" \
      --max-time 20
  else
    curl -fsS -X "$method" "$API_URL$path" \
      -H "Authorization: Bearer $WORKER_TOKEN" \
      -H "Content-Type: application/json" \
      --max-time 20 \
      -d "$body"
  fi
}

info "checking commands"
require_cmd curl
require_cmd jq
require_cmd systemctl

info "checking release layout"
check_file "$APP_ROOT/current"
check_file "$APP_ROOT/current/package.json"
check_file "$APP_ROOT/current/.next"
check_file "$APP_ROOT/shared/env/web.env"
check_file "$APP_ROOT/shared/env/worker.env"

info "loading runtime env"
load_env "$APP_ROOT/shared/env/web.env"
load_env "$APP_ROOT/shared/env/worker.env"

API_URL="${API_URL:-http://127.0.0.1:${PORT:-3000}}"

for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY WORKER_TOKEN API_URL; do
  if [[ -n "${!name:-}" ]]; then
    pass "$name present"
  else
    fail "$name missing"
  fi
done

info "checking systemd units"
check_systemd_active kvz-ai-web.service
check_systemd_active kvz-ai-worker.service
check_systemd_active kvz-ai-watchdog.timer

info "checking worker HTTP endpoints at $API_URL"
ops_smoke="$(http_json GET /api/ops/smoke || true)"
if echo "$ops_smoke" | jq -e '.ok == true' >/dev/null 2>&1; then
  pass "/api/ops/smoke"
else
  fail "/api/ops/smoke failed: ${ops_smoke:-empty response}"
fi

claim="$(http_json POST /api/tasks/claim '{"worker_id":"smoke-check"}' || true)"
if echo "$claim" | jq -e 'has("task")' >/dev/null 2>&1; then
  pass "/api/tasks/claim"
else
  fail "/api/tasks/claim failed: ${claim:-empty response}"
fi

watchdog="$(http_json POST /api/tasks/watchdog '{"timeout_minutes":5}' || true)"
if echo "$watchdog" | jq -e 'has("released")' >/dev/null 2>&1; then
  pass "/api/tasks/watchdog"
else
  fail "/api/tasks/watchdog failed: ${watchdog:-empty response}"
fi

agents="$(http_json GET '/api/agents?role=viewer' || true)"
if echo "$agents" | jq -e '.agents | type == "array"' >/dev/null 2>&1; then
  pass "/api/agents?role=viewer"
else
  fail "/api/agents?role=viewer failed: ${agents:-empty response}"
fi

kbs="$(http_json GET '/api/kb?role=viewer' || true)"
if echo "$kbs" | jq -e '.knowledge_bases | type == "array"' >/dev/null 2>&1; then
  pass "/api/kb?role=viewer"
else
  fail "/api/kb?role=viewer failed: ${kbs:-empty response}"
fi

if [[ "$failures" -gt 0 ]]; then
  fail "$failures smoke check(s) failed"
  exit 1
fi

pass "all smoke checks passed"
