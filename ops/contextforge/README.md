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
| Role | worker checks `knowledge_bases.allowed_roles` vs `profiles.role` before calling | a user reaching a KB not allowed for their role |

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
NOTEBOOKLM_MCP_PACKAGE=notebooklm-mcp-server@3.0.7
```

In `agent/.mcp.json`, connector keys (`knowledge_bases.mcp_server`) point at the
gateway route instead of spawning a local process, e.g. the gateway exposes each
registered connector under a stable path the orchestrator calls with the token.

## NotebookLM selection connector

The `notebooklm-selection` key is registered in `agent/.mcp.json` and in
`knowledge_bases` by migration `022_seed_notebooklm_selection.sql`.

Runtime auth is interactive and must happen under the same Linux user/profile
that runs the worker or connector container:

```bash
npx -y notebooklm-mcp-server@3.0.7 auth
```

Use a dedicated Google account, not a personal admin account. Share only the
notebooks needed for selection with that account. The browser session is local
runtime state and must not be copied into git, env files, logs, docs, or memory.

The upstream unofficial server exposes both query and mutation tools. In kvz-ai
it is registered as a read-only KB connector: agents are instructed to use
`notebook_list` / `notebook_query` only. Before broad production rollout, put a
thin allowlist wrapper or gateway policy in front of it so mutation tools such as
notebook/source create/delete are physically unavailable.

## Least-privilege checklist for live systems

- 1C / Bitrix: create a dedicated user with **read-only** access to only the
  needed objects — never an admin account.
- NotebookLM: create a dedicated Google account/profile with access only to the
  specific notebooks needed by this connector.
- Keep connectors **read-only by default**; enable writes per-connector, consciously.
- Every gateway call is audit-logged (who / role / which tool) — keep it on.
