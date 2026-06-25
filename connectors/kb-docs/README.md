# kb-docs — read-only knowledge-base MCP connector

NotebookLM-style document knowledge base for kvz-ai, exposed as an MCP server
behind ContextForge. Connector class: **read-only KB** (search/fetch, no mutation).

```
worker ──> ContextForge ──> kb-docs (this) ──> local document store
```

## Tools

| Tool | Input | Returns |
|---|---|---|
| `kb_search` | `{ query, limit? }` | ranked `{ hits: [{id, title, score, snippet}] }` |
| `kb_fetch` | `{ id }` | `{ found, id, title, tags, text }` |

Resource `kb://capabilities` — static connector metadata (tools, doc count, limits).

## Safety controls (per kvz-ai connector standard)

- **Read-only** — no mutation tools.
- **Strict input schemas** (zod): query length ≤ 500, result count ≤ 10, doc id
  slug-validated (rejects path traversal).
- **Output redaction** — secret-shaped tokens (`sk-…`, JWT, bearer, long hex) are
  stripped from results.
- **Auth** — when `CONNECTOR_TOKEN` is set, every call must present it (deny path).
- **Rate limit** — token bucket per process.
- **Audit log** — one structured JSON event per call on stderr (no secrets, no
  raw payloads): connector, tool, status, duration, role/task/run when supplied.
- **Egress: none** — serves a local document store, so SSRF is not applicable.

## Knowledge base content

Documents live in `data/` as `*.md` / `*.txt`. Format: first `# Heading` is the
title, an optional `tags: a, b` line sets tags, the rest is the body. The `id`
is the filename without extension. Mount a different directory via `KB_DOCS_DIR`.

## Develop

```bash
npm install
npm test          # vitest: schema, auth, rate-limit, search, redaction
npm run typecheck
npm run dev       # stdio MCP server (local, no token)
```

## Deploy (behind ContextForge)

Build the image and run it on the gateway's internal `connectors` network — no
published ports. ContextForge is the auth boundary; this connector additionally
checks `CONNECTOR_TOKEN` as defense in depth. Register the connector key
`kb-docs` so it matches `knowledge_bases.mcp_server` in the database.

```bash
cp .env.example .env   # set CONNECTOR_TOKEN
docker build -t kvz/kb-docs .
```
