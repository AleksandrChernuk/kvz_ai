# kb-docs — read-only RAG knowledge-base MCP connector

Role-scoped retrieval knowledge base for kvz-ai, exposed as an MCP server behind
ContextForge. Connector class: **read-only KB** (search/fetch, no mutation).
Retrieval is BM25 over passage chunks; the worker does the LLM grounding (the
connector holds no model credentials).

```
worker ──> ContextForge ──> kb-docs (this) ──> local document store (libraries)
```

## Libraries (role-scoped)

Documents are grouped into **libraries** = subfolders under `data/<library>/`.
Each library maps to one `knowledge_bases` row in kvz-ai with its own
`allowed_roles`, so the PM can give each role only the libraries it should see
(e.g. a welder reaches only `zvaryuvannya`, the PM reaches all). The connector
filters by the `library` argument; **role enforcement happens in the worker**
before the connector is called.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `kb_search` | `{ query, library?, limit? }` | ranked `{ hits: [{docId, library, title, score, snippet}] }` |
| `kb_fetch` | `{ id, library? }` | `{ found, id, library, title, tags, text }` |

Resource `kb://capabilities` — static metadata (tools, doc count, libraries, limits).

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

Documents live in `data/<library>/` as `*.md` / `*.txt` (files directly in
`data/` belong to the `default` library). Format: first `# Heading` is the
title, an optional `tags: a, b` line sets tags, the rest is the body. The `id`
is the filename without extension. Mount a different root via `KB_DOCS_DIR`.

Seeded example libraries: `zagalna` (all roles), `zvaryuvannya` (welding —
engineer/viewer), `finansy` (PM/managers). Wired to `knowledge_bases` rows by
migration 018.

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
