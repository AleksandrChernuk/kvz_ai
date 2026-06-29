# KVZ AI Server Ops

This folder describes the VPS layout for the MVP deployment. The app code stays
in the project root; runtime files, secrets, logs, and service configs are kept
separate on the server.

## Target Layout

```text
/opt/kvz-ai/
├── current -> /opt/kvz-ai/releases/<release-id>
├── releases/
│   └── <release-id>/
│       ├── src/
│       ├── public/
│       ├── supabase/
│       ├── agent/
│       ├── codex-agent/
│       ├── package.json
│       ├── package-lock.json
│       └── .next/
└── shared/
    ├── env/
    │   ├── web.env
    │   └── worker.env
    ├── logs/
    │   ├── web/
    │   └── worker/
    └── run/

/opt/supabase/
└── kvz-ai/
    ├── docker-compose.yml
    ├── .env
    ├── run.sh
    └── volumes/

/opt/kvz-mcp-gateway/
├── docker-compose.yml
├── .env
└── connectors/
```

## Services

- `kvz-ai-web`: Next.js app, listens on `127.0.0.1:3000`.
- `kvz-ai-worker`: polling worker for the task queue (`agent/scripts/poll.sh`).
- `kvz-ai-watchdog.timer`: independent stale-lock watchdog; keeps running even
  if the worker process crashes.
- `supabase/kvz-ai`: self-hosted Supabase via Docker Compose, API gateway on
  `127.0.0.1:8000` or `:8000` depending on Supabase compose defaults.
- `kvz-mcp-gateway`: ContextForge MCP gateway on `127.0.0.1:4444`. The only path
  from the worker to MCP connectors (NotebookLM, Bitrix24, 1C). Never proxied by
  Nginx — no public route by design. See `ops/contextforge/README.md`.
- Nginx: public reverse proxy from `80/443` to the Next.js and Supabase ports
  only. It must NOT expose Supabase Studio or the MCP gateway.

## Clean Existing KVZ/Supabase Files

This cleanup is scoped to `/opt/kvz-ai` and `/opt/supabase/kvz-ai`.

Archive current files:

```bash
sudo MODE=archive ./ops/server/clean-kvz-ai.sh
```

Delete current files and Docker volumes:

```bash
sudo MODE=wipe CONFIRM_WIPE=YES ./ops/server/clean-kvz-ai.sh
```

Use `archive` unless you are certain the current server data can be destroyed.

## Self-Host Supabase

Run on the VPS:

```bash
sudo SUPABASE_DOMAIN=supabase.example.com SITE_DOMAIN=ai.example.com \
  ./ops/supabase/setup-self-hosted.sh
```

The script uses the official Supabase Linux setup script, writes the public
Supabase URL and site URL into `/opt/supabase/kvz-ai/.env`, starts Docker
Compose, and prints the generated keys.

## First Server Setup

1. Create the runtime env files on the VPS:

   ```bash
   sudo mkdir -p /opt/kvz-ai/shared/env
   sudo install -m 600 /dev/null /opt/kvz-ai/shared/env/web.env
   sudo install -m 600 /dev/null /opt/kvz-ai/shared/env/worker.env
   ```

2. Materialize runtime values from 1Password into `/opt/kvz-ai/shared/env/*.env`.
   1Password is the source of truth; these files are server-local runtime state,
   owned by the app user and never committed.

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_PUBLISHABLE_KEY>
   SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SECRET_KEY>
   WORKER_TOKEN=<shared app/worker secret>
   ```

   ```text
   API_URL=https://ai.example.com
   WORKER_TOKEN=<same shared secret>
   ```

   The LLM runs via the Claude Code CLI under your subscription — run
   `claude login` on the worker host. No API key.

3. Deploy the Next.js app.
4. Run Supabase SQL migrations from `supabase/migrations/`:

   ```bash
   sudo ./ops/supabase/apply-migrations.sh
   ```

5. Create the first user in Supabase Studio, then set their role to `admin`.
6. Install SSL with Certbot or the server panel after Nginx is active.

## Deploy

From the local project:

```bash
SERVER=root@YOUR_SERVER DOMAIN=ai.example.com ./ops/deploy/deploy-release.sh
```

The script uploads a new release, validates web and worker runtime env, runs
`npm ci`, builds Next.js with the server env loaded, switches
`/opt/kvz-ai/current`, installs systemd/Nginx config, and restarts
`kvz-ai-web`, `kvz-ai-worker`, and `kvz-ai-watchdog.timer`. It then runs
`ops/deploy/smoke-check.sh` on the server.

## Smoke Check

Run after migrations/deploy, or any time the server feels suspicious:

```bash
SERVER=root@YOUR_SERVER ./ops/deploy/smoke-check.sh
```

On the VPS directly:

```bash
sudo /opt/kvz-ai/current/ops/deploy/smoke-check.sh
```

The smoke check verifies:

- release layout and runtime env files;
- required env variables are present;
- `kvz-ai-web`, `kvz-ai-worker`, and `kvz-ai-watchdog.timer` are active;
- worker-token endpoints respond:
  - `/api/ops/smoke`
  - `/api/tasks/claim`
  - `/api/tasks/watchdog`
  - `/api/agents?role=viewer`
  - `/api/kb?role=viewer`
- migration-backed access entities/functions are available via `ops_smoke_check()`.

## Rollback

On the VPS:

```bash
sudo ln -sfn /opt/kvz-ai/releases/<previous-release-id> /opt/kvz-ai/current
sudo systemctl restart kvz-ai-web kvz-ai-worker kvz-ai-watchdog.timer
```

Keep the newest two or three releases and delete old ones when disk space matters.

## Incident: disable task decomposition (orchestration kill-switch)

If decomposition misbehaves (runaway fan-out / LLM spend, bad plans), fall back to
the simple one-executor path without a redeploy:

```bash
echo 'ORCH_DISABLE=1' | sudo tee -a /opt/kvz-ai/shared/env/worker.env
sudo systemctl restart kvz-ai-worker
```

Tasks still process — they just route to a single executor (no plan/synthesize).
Remove the line and restart to re-enable. Related knobs in `worker.env`:
`ORCH_MAX_CONCURRENCY`, `PLAN_MAX_STEPS`, `ORCH_STEP_TIMEOUT`.
