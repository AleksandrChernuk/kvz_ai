# MCP Gateway (ContextForge)

Single controlled entrypoint between the worker and all MCP connectors
(NotebookLM, Bitrix24, 1C, ...). Replaces "worker talks to each MCP directly".

```text
worker ──(127.0.0.1:4444, CF_AUTH_TOKEN)──> ContextForge ──┬── NotebookLM MCP
                                                            ├── Bitrix24 MCP
                                                            └── 1C MCP
```

## Why a gateway

Connectors reach live corporate systems, so access is locked at three layers:

| Layer | Enforced by | Blocks |
|---|---|---|
| Network | `connectors` net `internal: true`, no `ports:` | reaching a connector from the host/app/internet |
| Token | `CF_AUTH_TOKEN` on the gateway | any caller without the worker token |
| Role | worker checks `connectors.allowed_roles` vs `profiles.role` before calling | a user reaching a connector not allowed for their role |

Connector credentials (Bitrix webhook, 1C OData user) are sourced from
**1Password** and materialized only into gateway/connector runtime env. The
worker and the Next.js app never see them.

## Layout on the VPS

```text
/opt/kvz-mcp-gateway/
├── docker-compose.yml
├── .env
└── connectors/
    ├── bitrix.env      # Bitrix24 REST creds (read-only user)
    └── onec.env        # 1C OData creds (read-only user)
```

## Setup

```bash
cp .env.example .env        # materialize CF_* runtime values from 1Password
docker compose --env-file .env up -d
```

The gateway binds to `127.0.0.1:4444` only. Nginx must **not** proxy it — there
is no public route to the MCP layer by design.

## Wiring the worker

Materialize these worker runtime values from 1Password:

```text
MCP_GATEWAY_URL=http://127.0.0.1:4444
MCP_GATEWAY_TOKEN=<same value as CF_AUTH_TOKEN>
NOTEBOOKLM_MCP_PACKAGE=notebooklm-mcp@2.0.0
```

In `agent/.mcp.json`, connector keys (`connectors.mcp_server`) point at the
gateway route instead of spawning a local process, e.g. the gateway exposes each
registered connector under a stable path the orchestrator calls with the token.

## NotebookLM connector

Runs as the `notebooklm` service in this compose (image `kvz/notebooklm-mcp`,
built from [`connectors/notebooklm/`](../../connectors/notebooklm/)). The
`notebooklm-selection` key is registered in `agent/.mcp.json` and in
`connectors` (after migration `025_rename_kb_to_connectors.sql`).

It wraps the unofficial [`notebooklm-mcp@2.0.0`](https://github.com/PleasePrompto/notebooklm-mcp),
which uses a **persistent Chrome profile** (Patchright) rather than cookie-file
scraping — so the Google session (including the `__Secure-*PSIDTS` rotation
cookies) stays fresh and does not silently expire. Log in once; every run after
is headless.

**Read-only is enforced at the connector**, not by prompt text:
`NOTEBOOKLM_PROFILE=minimal` + `NOTEBOOKLM_DISABLED_TOOLS=…` physically remove
every mutation / auth / session-admin tool. Agent-facing surface is
`ask_question`, `list_notebooks`, `get_notebook`, `search_notebooks`,
`get_library_stats`. (This is the "thin allowlist so mutation tools are
physically unavailable" that older notes asked for.)

Auth is a persistent Chrome profile on the `cf_notebooklm_profile` volume,
seeded **once** with a **dedicated Google account** (never a personal admin
account) shared only with the needed notebooks. The profile is live runtime
state — never copy it into git, env files, logs, docs, or memory. Seed it
either locally and `rsync` the `chrome_profile/` dir into the volume, or on the
VPS under `xvfb-run` + a one-time VNC login — see
[`connectors/notebooklm/README.md`](../../connectors/notebooklm/README.md).

The connector reaches `notebooklm.google.com`, so its service also joins the
non-internal `egress` network (the sealed `connectors` net has no egress).

## Least-privilege checklist for live systems

- 1C / Bitrix: create a dedicated user with **read-only** access to only the
  needed objects — never an admin account.
- NotebookLM: create a dedicated Google account/profile with access only to the
  specific notebooks needed by this connector.
- Keep connectors **read-only by default**; enable writes per-connector, consciously.
- Every gateway call is audit-logged (who / role / which tool) — keep it on.
