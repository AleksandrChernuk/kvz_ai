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

psql_db() { docker compose exec -T db psql -U postgres -d postgres "$@"; }

# Трекінг застосованих міграцій — ідемпотентність: повторний запуск не переграє
# вже застосовані файли (раніше цикл сліпо переганяв усі щоразу).
psql_db -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now());"

applied=0
for sql in "$MIGRATIONS_DIR"/*.sql; do
  [[ -f "$sql" ]] || continue
  name="$(basename "$sql")"
  esc="${name//\'/\'\'}"
  already="$(psql_db -tAc "select 1 from schema_migrations where filename = '$esc'" | tr -d '[:space:]')"
  if [[ "$already" == "1" ]]; then
    echo "Skipping $name (already applied)"
    continue
  fi
  echo "Applying $name"
  # Кожну міграцію — в одній транзакції; журналимо лише при успіху.
  psql_db -v ON_ERROR_STOP=1 --single-transaction < "$sql"
  psql_db -v ON_ERROR_STOP=1 -q -c \
    "insert into schema_migrations (filename) values ('$esc') on conflict do nothing;"
  applied=$((applied + 1))
done

echo "Migrations applied (${applied} new)."
