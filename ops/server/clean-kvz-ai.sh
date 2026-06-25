#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/kvz-ai}"
SUPABASE_PROJECT="${SUPABASE_PROJECT:-/opt/supabase/kvz-ai}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups}"
MODE="${MODE:-archive}"
CONFIRM_WIPE="${CONFIRM_WIPE:-}"

if [[ "$MODE" != "archive" && "$MODE" != "wipe" ]]; then
  echo "MODE must be archive or wipe" >&2
  exit 1
fi

if [[ "$MODE" == "wipe" && "$CONFIRM_WIPE" != "YES" ]]; then
  echo "Refusing wipe. Run with MODE=wipe CONFIRM_WIPE=YES to delete KVZ app/Supabase files and Docker volumes." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%d%H%M%S)"

systemctl stop kvz-ai-worker 2>/dev/null || true
systemctl disable kvz-ai-worker 2>/dev/null || true
systemctl stop kvz-ai-web 2>/dev/null || true
systemctl disable kvz-ai-web 2>/dev/null || true

if [[ -d "$SUPABASE_PROJECT" ]]; then
  (
    cd "$SUPABASE_PROJECT"
    if [[ "$MODE" == "wipe" ]]; then
      docker compose down -v --remove-orphans 2>/dev/null || true
    else
      sh run.sh stop 2>/dev/null || docker compose stop 2>/dev/null || true
    fi
  )
fi

if [[ "$MODE" == "archive" ]]; then
  mkdir -p "$BACKUP_ROOT"
  if [[ -e "$APP_ROOT" ]]; then
    mv "$APP_ROOT" "$BACKUP_ROOT/kvz-ai.$stamp"
    echo "Archived $APP_ROOT -> $BACKUP_ROOT/kvz-ai.$stamp"
  fi
  if [[ -e "$SUPABASE_PROJECT" ]]; then
    mkdir -p "$BACKUP_ROOT/supabase"
    mv "$SUPABASE_PROJECT" "$BACKUP_ROOT/supabase/kvz-ai.$stamp"
    echo "Archived $SUPABASE_PROJECT -> $BACKUP_ROOT/supabase/kvz-ai.$stamp"
  fi
else
  rm -rf "$APP_ROOT" "$SUPABASE_PROJECT"
  echo "Deleted $APP_ROOT and $SUPABASE_PROJECT"
fi

rm -f /etc/systemd/system/kvz-ai-web.service /etc/systemd/system/kvz-ai-worker.service
systemctl daemon-reload 2>/dev/null || true

echo "KVZ AI cleanup complete. Mode: $MODE"
