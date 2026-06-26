# DB integration tests

Runs the **real** migrations + queue functions + RLS against a throwaway
Postgres — not the migration *text* (`queue-migrations.test.ts` does that). This
is the layer that catches execution regressions like the `complete_task` guard
that a text assertion missed.

```bash
./scripts/db-test/run.sh
```

No Docker needed — uses a local `initdb`/`pg_ctl` cluster in a temp dir, applies
`prelude.sql` (stubs the Supabase `auth` schema + roles + `auth.uid()` via a
GUC), applies every `supabase/migrations/*.sql` in order, then runs `tests.sql`.
Tears everything down on exit. Exits non-zero on any migration or assertion
failure. Also runs in CI.

## What `tests.sql` asserts

- **A** claim → running; `save_checkpoint` by the wrong worker raises; `complete_task`
  marks done and inserts the assistant message.
- **B** re-completing a done task raises (running guard); empty answer raises.
- **C** approval gate: `request_approval` → `awaiting_approval`; owner `approve_task`
  re-queues with `approved_at`; completing with a **different** result raises
  (014 binding); the approved result completes.
- **D** completing with a null agent raises (016 agent-required guard).
- **E** RLS: as `authenticated`, a user sees only their own threads.

## Requirements

`initdb`, `pg_ctl`, `psql`, `createdb` on PATH (Homebrew `postgresql@16` locally;
on CI the runner's `/usr/lib/postgresql/*/bin`). The harness forces `LC_ALL=C`
because the host locale env may be broken.

## Adding tests

Extend `tests.sql` with a `DO $$ … RAISE EXCEPTION on failure … $$;` block.
`prelude.sql` only stubs what migrations reference — keep it minimal.
