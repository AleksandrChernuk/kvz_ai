#!/usr/bin/env bash
# Integration test harness: spin up a throwaway Postgres, stub the Supabase
# schema (auth + roles), apply ALL migrations in order, then run real
# function/RLS tests. No Docker required — uses a local `initdb`/`pg_ctl`.
#
#   ./scripts/db-test/run.sh
#
# Exits non-zero if any migration or assertion fails.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DBT="$ROOT/scripts/db-test"
PGDATA="$(mktemp -d)/pgdata"
SOCK="$(mktemp -d)"
DB="kvztest"

for bin in initdb pg_ctl psql createdb; do
  command -v "$bin" >/dev/null || { echo "need $bin (Postgres client/server)"; exit 1; }
done

cleanup() {
  pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA" "$SOCK" 2>/dev/null || true
}
trap cleanup EXIT

echo "init cluster…"
# Force a safe locale; the host env may have broken LANG/LC_* and UTF8 encoding
# is needed for the Ukrainian content in tests.
export LC_ALL=C LANG=C
initdb -D "$PGDATA" -U postgres --auth=trust --locale=C --encoding=UTF8 >/dev/null
PORT=54399
pg_ctl -D "$PGDATA" -l "$PGDATA/log" \
  -o "-k $SOCK -p $PORT -c listen_addresses=''" -w start >/dev/null || {
  echo "--- server log ---"; cat "$PGDATA/log" 2>/dev/null; exit 1;
}
createdb -h "$SOCK" -p "$PORT" -U postgres "$DB"

psql_db() { psql -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -q "$@"; }

echo "prelude (supabase stubs)…"
psql_db -f "$DBT/prelude.sql" >/dev/null

echo "apply migrations…"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '  %s\n' "$(basename "$f")"
  # psql runs each statement autocommitted, so `alter type … add value` is safe.
  psql_db -f "$f" >/dev/null
done

echo "run integration tests…"
psql_db -f "$DBT/tests.sql"

echo "OK — integration tests passed."
