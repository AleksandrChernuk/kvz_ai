# NotebookLM MCP connector

Containerized, **read-only** wrapper around the unofficial
[`notebooklm-mcp`](https://github.com/PleasePrompto/notebooklm-mcp) (PleasePrompto,
`notebooklm-mcp@2.0.0`). It lets agents ask grounded, citation-backed questions
against the company's NotebookLM notebooks, behind ContextForge.

```text
worker → ContextForge (127.0.0.1:4444) → notebooklm connector → notebooklm.google.com
```

## Why this connector (and not cookie scraping)

The connector keeps a **persistent Chrome profile** (Patchright) instead of
scraping cookies into a file. Chrome itself keeps the Google session fresh
(including the `__Secure-*PSIDTS` rotation cookies), so the session does not
silently expire the way a cookie-file dump does. Log in once; every run after is
fully headless.

## Read-only by design

Read-only is enforced **at the connector**, not just by prompt text:

- `NOTEBOOKLM_PROFILE=minimal` — narrow default tool surface.
- `NOTEBOOKLM_DISABLED_TOOLS=…` — explicitly removes every mutation / auth /
  session-admin tool (`add_source`, `add_notebook`, `update_notebook`,
  `remove_notebook`, `generate_audio`, `download_audio`, `cleanup_data`,
  `setup_auth`, `re_auth`, `select_notebook`, `close_session`, `reset_session`).

Agent-facing tools that remain: `ask_question`, `list_notebooks`,
`get_notebook`, `search_notebooks`, `get_library_stats`, `get_health`.
Notebooks are targeted per call by passing `notebook_id` / `notebook_url` to
`ask_question` — no stateful `select_notebook` needed.

Role gating (which role may reach which notebook) lives in kvz-ai
(`knowledge_bases` + `knowledge_base_role_access`), not in this connector.

## Auth: seed the persistent profile once

Auth state is the `chrome_profile/` directory on the `/data` volume
(`/data/notebooklm-mcp/chrome_profile/` inside the container). Use a **dedicated
Google account** shared only with the notebooks this connector needs — never a
personal admin account. The profile is live runtime state: never copy it into
git, env files, logs, docs, or memory.

Two ways to seed it:

### A. Seed locally, copy the profile up (simplest)

On a machine with a display, log in once, then ship the resulting profile
directory into the VPS volume:

The runtime state is a **named Docker volume** (`cf_notebooklm_profile`), not a
host path — so seed it into the volume via a helper container, not a direct
`rsync` to disk.

```bash
# 1) Log in locally (opens Chrome; confirm list_notebooks works, then stop).
node agent/scripts/notebooklm/mcp_client.mjs setup
#    macOS profile dir: ~/Library/Application Support/notebooklm-mcp/chrome_profile/

# 2) Ship the profile to a temp dir on the VPS.
rsync -a "$HOME/Library/Application Support/notebooklm-mcp/chrome_profile/" \
  vps:/tmp/nblm-seed/chrome_profile/

# 3) On the VPS, load the temp dir INTO the named volume, then discard it.
ssh vps 'docker run --rm \
  -v cf_notebooklm_profile:/data \
  -v /tmp/nblm-seed:/seed:ro \
  alpine sh -c "mkdir -p /data/notebooklm-mcp && cp -a /seed/chrome_profile /data/notebooklm-mcp/" \
  && rm -rf /tmp/nblm-seed'
```

### B. Seed on the VPS under xvfb + VNC (keeps everything server-side)

Run a one-off container with a display so `setup_auth` can open a window you
reach once over VNC:

```bash
docker run --rm -it \
  -e HEADLESS=false \
  -v cf_notebooklm_profile:/data \
  --entrypoint bash kvz/notebooklm-mcp:latest \
  -lc 'xvfb-run -a notebooklm-mcp &   # then VNC in and complete Google login'
```

After either path, the normal headless service reuses `/data` and stays logged
in. Re-auth (rare) = repeat the seed.

## Build & run

Built and run as part of the ContextForge stack — see
[`ops/contextforge/`](../../ops/contextforge/). Standalone build:

```bash
docker build -t kvz/notebooklm-mcp:latest connectors/notebooklm
```

Config: [`.env.example`](.env.example) (no secrets; auth is the profile volume).
