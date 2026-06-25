#!/usr/bin/env bash
set -euo pipefail

SUPABASE_PROJECT="${SUPABASE_PROJECT:-/opt/supabase/kvz-ai}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/opt/kvz-ai/current/supabase/migrations}"

if [[ ! -d "$SUPABASE_PROJECT" ]]; then
  echo "Supabase project not found: $SUPABASE_PROJECT" >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

cd "$SUPABASE_PROJECT"

for sql in "$MIGRATIONS_DIR"/*.sql; do
  [[ -f "$sql" ]] || continue
  echo "Applying $(basename "$sql")"
  docker compose exec -T db psql -U postgres -d postgres < "$sql"
done

echo "Migrations applied."
