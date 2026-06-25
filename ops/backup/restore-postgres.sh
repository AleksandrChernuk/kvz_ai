#!/usr/bin/env bash
# Restore a Postgres dump produced by backup-postgres.sh.
#
# Usage (on the VPS):
#   sudo ./ops/backup/restore-postgres.sh supabase /opt/backups/postgres/supabase-postgres-YYYYMMDD-HHMMSS.sql.gz
#   sudo ./ops/backup/restore-postgres.sh gateway  /opt/backups/postgres/gateway-contextforge-...sql.gz
#
# DESTRUCTIVE: applies --clean dump over the target database. Take a fresh
# backup first.

set -euo pipefail

target="${1:-}"
dump_file="${2:-}"

if [ -z "$target" ] || [ -z "$dump_file" ]; then
  echo "usage: $0 <supabase|gateway> <dump.sql.gz>" >&2
  exit 1
fi
if [ ! -f "$dump_file" ]; then
  echo "dump not found: $dump_file" >&2
  exit 1
fi

case "$target" in
  supabase) dir="${SUPABASE_DIR:-/opt/supabase/kvz-ai}"; service="${SUPABASE_DB_SERVICE:-db}"; user="${SUPABASE_DB_USER:-postgres}"; db="${SUPABASE_DB_NAME:-postgres}" ;;
  gateway)  dir="${GATEWAY_DIR:-/opt/kvz-mcp-gateway}";   service="${GATEWAY_DB_SERVICE:-db}";  user="${GATEWAY_DB_USER:-contextforge}"; db="${GATEWAY_DB_NAME:-contextforge}" ;;
  *) echo "unknown target: $target (expected supabase|gateway)" >&2; exit 1 ;;
esac

read -r -p "Restore ${target} DB '${db}' from $(basename "$dump_file")? This overwrites data. [yes/N] " ans
[ "$ans" = "yes" ] || { echo "aborted."; exit 1; }

echo "restoring ${target} (${db}) ..."
gunzip -c "$dump_file" | ( cd "$dir" && docker compose exec -T "$service" psql -U "$user" -d "$db" )
echo "done."
