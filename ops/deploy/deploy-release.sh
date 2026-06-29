#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-kvz-ai}"
APP_ROOT="${APP_ROOT:-/opt/kvz-ai}"
APP_USER="${APP_USER:-kvzai}"
NODE_ENV="${NODE_ENV:-production}"
PORT="${PORT:-3000}"
SERVER="${SERVER:-}"
DOMAIN="${DOMAIN:-_}"
SUPABASE_DOMAIN="${SUPABASE_DOMAIN:-}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"

if [[ -z "$SERVER" ]]; then
  echo "SERVER is required, example: SERVER=root@203.0.113.10 DOMAIN=ai.example.com $0" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Deploying $APP_NAME release $RELEASE_ID to $SERVER:$RELEASE_DIR"

ssh "$SERVER" "sudo useradd --system --home '$APP_ROOT' --shell /usr/sbin/nologin '$APP_USER' 2>/dev/null || true
sudo mkdir -p '$APP_ROOT/releases' '$APP_ROOT/shared/env' '$APP_ROOT/shared/logs/web' '$APP_ROOT/shared/logs/worker' '$APP_ROOT/shared/logs/watchdog' '$APP_ROOT/shared/run'
sudo chown -R '$APP_USER:$APP_USER' '$APP_ROOT'
if [ ! -f '$APP_ROOT/shared/env/web.env' ]; then
  sudo install -m 600 -o '$APP_USER' -g '$APP_USER' /dev/null '$APP_ROOT/shared/env/web.env'
  echo 'Created empty $APP_ROOT/shared/env/web.env. Materialize runtime values from 1Password before the first successful build.' >&2
fi
if [ ! -f '$APP_ROOT/shared/env/worker.env' ]; then
  sudo install -m 600 -o '$APP_USER' -g '$APP_USER' /dev/null '$APP_ROOT/shared/env/worker.env'
  echo 'Created empty $APP_ROOT/shared/env/worker.env. Materialize runtime values from 1Password before the first successful worker start.' >&2
fi
sudo mkdir -p '$RELEASE_DIR'
sudo chown -R '$APP_USER:$APP_USER' '$RELEASE_DIR'"

rsync -az --delete \
  --exclude ".git" \
  --exclude ".next" \
  --exclude "node_modules" \
  --exclude ".env*" \
  --exclude "coverage" \
  --exclude "*.tsbuildinfo" \
  "$ROOT_DIR/" "$SERVER:$RELEASE_DIR/"

ssh "$SERVER" "sudo chown -R '$APP_USER:$APP_USER' '$RELEASE_DIR'
cd '$RELEASE_DIR'
set -a
. '$APP_ROOT/shared/env/web.env'
set +a
missing=0
for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY WORKER_TOKEN; do
  eval value=\\\${\$name:-}
  if [ -z \"\$value\" ]; then
    echo \"Missing required web env: \$name\" >&2
    missing=1
  fi
done
set -a
. '$APP_ROOT/shared/env/worker.env'
set +a
for name in API_URL WORKER_TOKEN; do
  eval value=\\\${\$name:-}
  if [ -z \"\$value\" ]; then
    echo \"Missing required worker env: \$name\" >&2
    missing=1
  fi
done
# LLM runs via the Claude Code CLI under subscription (claude login on the host),
# so no ANTHROPIC_API_KEY is required in worker env.
[ \"\$missing\" -eq 0 ]
npm ci
NODE_ENV='$NODE_ENV' npm run build
sudo ln -sfn '$RELEASE_DIR' '$APP_ROOT/current'
sudo chown -h '$APP_USER:$APP_USER' '$APP_ROOT/current'"

tmp_service="$(mktemp)"
tmp_worker_service="$(mktemp)"
tmp_watchdog_service="$(mktemp)"
tmp_watchdog_timer="$(mktemp)"
tmp_nginx="$(mktemp)"
tmp_supabase_nginx=""
sed \
  -e "s#__APP_ROOT__#$APP_ROOT#g" \
  -e "s#__APP_USER__#$APP_USER#g" \
  -e "s#__NODE_ENV__#$NODE_ENV#g" \
  -e "s#__PORT__#$PORT#g" \
  "$ROOT_DIR/ops/systemd/kvz-ai-web.service" > "$tmp_service"

sed \
  -e "s#__APP_ROOT__#$APP_ROOT#g" \
  -e "s#__APP_USER__#$APP_USER#g" \
  "$ROOT_DIR/ops/systemd/kvz-ai-worker.service" > "$tmp_worker_service"

sed \
  -e "s#__APP_ROOT__#$APP_ROOT#g" \
  -e "s#__APP_USER__#$APP_USER#g" \
  "$ROOT_DIR/ops/systemd/kvz-ai-watchdog.service" > "$tmp_watchdog_service"

cp "$ROOT_DIR/ops/systemd/kvz-ai-watchdog.timer" "$tmp_watchdog_timer"

sed \
  -e "s#__DOMAIN__#$DOMAIN#g" \
  -e "s#__PORT__#$PORT#g" \
  "$ROOT_DIR/ops/nginx/kvz-ai.conf" > "$tmp_nginx"

scp "$tmp_service" "$SERVER:/tmp/kvz-ai-web.service"
scp "$tmp_worker_service" "$SERVER:/tmp/kvz-ai-worker.service"
scp "$tmp_watchdog_service" "$SERVER:/tmp/kvz-ai-watchdog.service"
scp "$tmp_watchdog_timer" "$SERVER:/tmp/kvz-ai-watchdog.timer"
scp "$tmp_nginx" "$SERVER:/tmp/kvz-ai.conf"
if [[ -n "$SUPABASE_DOMAIN" ]]; then
  tmp_supabase_nginx="$(mktemp)"
  sed \
    -e "s#__SUPABASE_DOMAIN__#$SUPABASE_DOMAIN#g" \
    "$ROOT_DIR/ops/nginx/supabase.conf" > "$tmp_supabase_nginx"
  scp "$tmp_supabase_nginx" "$SERVER:/tmp/kvz-ai-supabase.conf"
fi
rm -f "$tmp_service" "$tmp_worker_service" "$tmp_watchdog_service" "$tmp_watchdog_timer" "$tmp_nginx"
if [[ -n "$tmp_supabase_nginx" ]]; then
  rm -f "$tmp_supabase_nginx"
fi

ssh "$SERVER" "sudo mv /tmp/kvz-ai-web.service /etc/systemd/system/kvz-ai-web.service
sudo mv /tmp/kvz-ai-worker.service /etc/systemd/system/kvz-ai-worker.service
sudo mv /tmp/kvz-ai-watchdog.service /etc/systemd/system/kvz-ai-watchdog.service
sudo mv /tmp/kvz-ai-watchdog.timer /etc/systemd/system/kvz-ai-watchdog.timer
sudo systemctl daemon-reload
sudo systemctl enable kvz-ai-web
sudo systemctl enable kvz-ai-worker
sudo systemctl enable kvz-ai-watchdog.timer
# DB-міграції ДО рестарту воркера (ідемпотентні; tracking у schema_migrations).
# Інакше новий код міг би стартувати без 019/020 і orchestrated-задачі падали б
# на завершенні. Пропускаємо, якщо self-hosted Supabase не на цьому хості.
if [ -x /opt/kvz-ai/current/ops/supabase/apply-migrations.sh ] && [ -d /opt/supabase/kvz-ai ]; then
  sudo /opt/kvz-ai/current/ops/supabase/apply-migrations.sh
fi
sudo systemctl restart kvz-ai-web
sudo systemctl restart kvz-ai-worker
sudo systemctl restart kvz-ai-watchdog.timer
if command -v nginx >/dev/null 2>&1; then
  sudo mv /tmp/kvz-ai.conf /etc/nginx/sites-available/kvz-ai.conf
  sudo ln -sfn /etc/nginx/sites-available/kvz-ai.conf /etc/nginx/sites-enabled/kvz-ai.conf
  if [ -f /tmp/kvz-ai-supabase.conf ]; then
    sudo mv /tmp/kvz-ai-supabase.conf /etc/nginx/sites-available/kvz-ai-supabase.conf
    sudo ln -sfn /etc/nginx/sites-available/kvz-ai-supabase.conf /etc/nginx/sites-enabled/kvz-ai-supabase.conf
  fi
  sudo nginx -t
  sudo systemctl reload nginx
else
  echo 'Nginx is not installed. Web service is running on 127.0.0.1:$PORT.' >&2
fi
sudo systemctl --no-pager --full status kvz-ai-web | sed -n '1,18p'
sudo systemctl --no-pager --full status kvz-ai-worker | sed -n '1,18p'
sudo systemctl --no-pager --full status kvz-ai-watchdog.timer | sed -n '1,18p'
sudo APP_ROOT='$APP_ROOT' APP_USER='$APP_USER' '$APP_ROOT/current/ops/deploy/smoke-check.sh'"

echo "Done. Release: $RELEASE_ID"
