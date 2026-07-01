# Deploy: Vercel (app) + Supabase Cloud (DB) + worker host

Three pieces. The app and DB are easy; the **worker is the catch** — read the
warning first.

```
Browser ─→ Vercel (Next.js: UI + /api/*) ─→ Supabase Cloud (Auth + Postgres + Realtime)
                                                      ↑
                                         Worker host (poll.sh) ── persistent, NOT Vercel
```

## ⚠️ The worker cannot run on Vercel

Vercel is serverless — there is **no place for the long-running `poll.sh` loop**.
With only Vercel + Supabase, a user can log in and send a message, the task is
queued… and **nothing ever answers it**. The worker is the brain.

The worker must run on something always-on: a small VPS, Railway/Fly.io/Render
worker, or even your Mac for testing. It needs `node`, `jq`, `curl`, `python3`,
a **logged-in `claude` CLI** (your subscription), and the built connector.

The LLM runs through the **Claude Code CLI under subscription** (`claude -p`) —
**no `ANTHROPIC_API_KEY`, no per-token billing**. Env vars:

```
API_URL=https://<your-vercel-app>.vercel.app
WORKER_TOKEN=<same value as in Vercel>
# CLAUDE_MODEL=opus   (optional)
KB_QUERY_JS=<repo>/connectors/kb-docs/dist/query-cli.js   # default works from repo root
```

Run it:
```bash
claude login                       # Claude subscription — the brain (router)
codex login                        # Codex subscription — executor (code/technical)
# gemini auth (CLI login or config) — executor (knowledge); optional for now
cd connectors/kb-docs && npm ci && npm run build && cd ../..
cp agent/.env.example agent/.env   # fill API_URL, WORKER_TOKEN
./agent/scripts/poll.sh            # or --once on a cron / a systemd service
```

The brain (Claude) routes to Codex (the only active executor today — `handle_gemini.sh`
is kept in the tree but `handle_task.sh` no longer dispatches to it). Fail-soft —
until `codex` is logged in, tasks fall back to Claude answering, so nothing breaks.

**Also schedule the watchdog independently of `poll.sh`** — without it, a worker
that crashes mid-task leaves that task `running` forever (nobody ever calls
`/api/tasks/watchdog` again). A bare one-off `curl` is not enough; it needs to run
on a recurring schedule, separate from the worker process itself:

- **macOS (no systemd)** — use `launchd`, not `cron` (TCC restrictions make
  plain cron unreliable for network calls on modern macOS):
  ```bash
  cp agent/scripts/com.kvz-ai.watchdog.plist.example \
     ~/Library/LaunchAgents/com.kvzai.watchdog.plist
  # edit the /ABSOLUTE/PATH/TO/kvz-ai placeholders inside, then:
  launchctl load ~/Library/LaunchAgents/com.kvzai.watchdog.plist
  ```
  Runs `agent/scripts/watchdog.sh` every 60s; logs to `agent/watchdog.log`.
- **Linux VPS** — prefer the systemd units already in `ops/systemd/` (installed
  automatically by `ops/deploy/deploy-release.sh`): `kvz-ai-watchdog.timer` +
  `.service`, independent of the `kvz-ai-worker.service` process.
- **Anything else (Railway/Fly.io/Render/etc.)** — add `agent/scripts/watchdog.sh`
  as that platform's own scheduled/cron job (reads `API_URL`/`WORKER_TOKEN` from
  `agent/.env`, same file `poll.sh` uses).

## 1. Supabase Cloud

1. [supabase.com](https://supabase.com) → New project. Copy from **Settings → API**:
   `Project URL`, `anon public`, `service_role`.
2. **SQL Editor** → run every `supabase/migrations/*.sql` **in numeric order**
   (001 → highest; currently **023** — check `ls supabase/migrations/` for the
   real latest, this number will go stale again). 019–020 add the `orchestrated`
   agent value and exempt it from the access gate — without them decomposed
   tasks fail at completion. 021 is required for new-user signup to work at all
   on Supabase Cloud. 023 is required for the approval-resume flow (held
   irreversible steps actually executing after human approval) to work.
3. **Authentication → Add user** → then in SQL Editor:
   `update profiles set role='admin' where user_id=(select id from auth.users where email='you@example.com');`
4. Realtime is on by default; the migrations add `messages`/`tasks` to the
   publication. Verify a second user can't see the first user's rows.

## 2. Vercel (app)

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new) (framework
   auto-detected as Next.js).
2. **Environment Variables** (Production + Preview):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
   WORKER_TOKEN=<openssl rand -hex 32 — same value the worker uses>
   ```
   (No `ANTHROPIC_API_KEY` here — that's worker-only.)
3. Deploy. `connectors/` and `agent/` are ignored by the Next build; they ship
   to the worker host, not Vercel.

## 3. Verify end to end

1. Open the Vercel URL, log in, send a message → it appears optimistically.
2. With the worker running against `API_URL`, the task is claimed and answered;
   the assistant reply streams in via Supabase Realtime.
3. Ask something covered by a seeded library (e.g. welding) → grounded answer
   with `[library/document]` sources.

## Notes / limits on serverless

- `/api/tasks/[taskId]/stream` (SSE) is best-effort on Vercel (`maxDuration`
  caps it). The UI relies on Supabase Realtime, so this is fine.
- Keep `service_role` only in Vercel server env — never expose it to the client.
- MCP gateway (ContextForge) and hardened connectors are a separate concern;
  `kb-docs` runs on the worker host for now (no secrets, no egress).
