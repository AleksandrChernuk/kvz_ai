#!/usr/bin/env bash
# Postgres backups for the self-hosted stack (Supabase app DB + ContextForge DB).
# Self-hosting moves backup responsibility onto us — run this on a cron.
#
# Usage (on the VPS):
#   sudo ./ops/backup/backup-postgres.sh
#
# Override defaults via env:
#   BACKUP_DIR, RETENTION_DAYS,
#   SUPABASE_DIR, SUPABASE_DB_SERVICE, SUPABASE_DB_USER, SUPABASE_DB_NAME,
#   GATEWAY_DIR, GATEWAY_DB_SERVICE, GATEWAY_DB_USER, GATEWAY_DB_NAME

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/kvz-ai}"
SUPABASE_DB_SERVICE="${SUPABASE_DB_SERVICE:-db}"
SUPABASE_DB_USER="${SUPABASE_DB_USER:-postgres}"
SUPABASE_DB_NAME="${SUPABASE_DB_NAME:-postgres}"

GATEWAY_DIR="${GATEWAY_DIR:-/opt/kvz-mcp-gateway}"
GATEWAY_DB_SERVICE="${GATEWAY_DB_SERVICE:-db}"
GATEWAY_DB_USER="${GATEWAY_DB_USER:-contextforge}"
GATEWAY_DB_NAME="${GATEWAY_DB_NAME:-contextforge}"

ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

dump() {
  local label="$1" dir="$2" service="$3" user="$4" db="$5"
  local out="$BACKUP_DIR/${label}-${db}-${ts}.sql.gz"
  if [ ! -d "$dir" ]; then
    echo "skip ${label}: ${dir} not found"
    return 0
  fi
  echo "dumping ${label} (${db}) -> ${out}"
  ( cd "$dir" && docker compose exec -T "$service" \
      pg_dump -U "$user" -d "$db" --no-owner --clean --if-exists ) \
    | gzip > "$out"
  echo "  $(du -h "$out" | cut -f1)"
}

dump "supabase" "$SUPABASE_DIR" "$SUPABASE_DB_SERVICE" "$SUPABASE_DB_USER" "$SUPABASE_DB_NAME"
dump "gateway"  "$GATEWAY_DIR"  "$GATEWAY_DB_SERVICE"  "$GATEWAY_DB_USER"  "$GATEWAY_DB_NAME"

echo "pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name '*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete

echo "done."
