# connectors/kb-docs/ — read-only RAG knowledge base

Reference connector. Usage/deploy is in **`README.md`**; this is the code map and
the invariants. Separate toolchain — verify here, not from the repo root:

```bash
npm test && npm run typecheck     # 21 tests; root tsc/eslint exclude this folder
```

## Code map (src/)

| File | Role | Pure/testable? |
|---|---|---|
| `store.ts` | docs → libraries → chunks; BM25 `search`, `getById`, `listLibraries` | ✅ pure |
| `connector.ts` | `KbDocsConnector` — auth + rate-limit + schema + audit around search/fetch | ✅ pure (mockable) |
| `schema.ts` | zod input schemas (query/result limits, slug-validated id/library) | ✅ |
| `redact.ts` | strip secret-shaped tokens from output | ✅ |
| `ratelimit.ts` | token bucket | ✅ |
| `audit.ts` | structured per-call event (no secrets) | ✅ |
| `config.ts` | limits + `CONNECTOR_TOKEN` + `KB_DOCS_DIR` | |
| `server.ts` | MCP stdio server (protocol wiring only) | runtime |
| `query-cli.ts` | retrieval CLI the worker calls for grounding | runtime |

Correctness lives in the **pure** modules and is unit-tested. `server.ts` and
`query-cli.ts` are thin wrappers — keep logic out of them.

## Invariants

- **Read-only.** No mutation tools, ever. Egress: none (local store) — keep it so.
- **The worker enforces role access** (which libraries a role may query) *before*
  calling this connector; the connector filters by `library` but is not the
  authority. Don't move role logic in here.
- **Grounding (the LLM answer) happens in the worker**, not here — the connector
  holds no model credentials. It only retrieves passages.
- Strict schemas reject path-traversal ids and bad library slugs; output is
  redacted. Don't relax these.
- Libraries = `data/<library>/` subfolders; each maps to one `knowledge_bases`
  row (migration 018). Adding a library = add the folder + a KB row + role access.
