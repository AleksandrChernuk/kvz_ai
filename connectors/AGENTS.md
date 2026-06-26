# connectors/ — MCP connectors

Each connector is a **separate deployable** behind ContextForge, with its own
toolchain (own `package.json`/`tsconfig`/`vitest`) and its **own container**. They
are excluded from the root `tsc`/eslint and from `npm test` — verify each
connector inside its own folder.

> **Use the `mcp-connector-builder` skill** (`.codex/skills/mcp-connector-builder`)
> for any connector work. It carries the kvz-ai connector standard, review
> checklist, and security rules. Read it before editing.

## Topology (target)

```
worker → ContextForge → connector container (internal net, no ports:, cap-drop,
                        read-only FS, egress allowlist, digest-pinned image)
```

Connectors are mutually unconnected; sensitivity zones are separated by network:
low-trust (kb-docs, no egress) must not be able to reach high-trust (Bitrix/1C).

## Rules (connector standard)

- Read-only by default; writes route through the task approval gate.
- Strict input schemas (zod), output redaction of secret-shaped tokens, per-tool
  rate limit + timeout, structured audit log (no secrets/raw payloads).
- Vendor credentials live **only** in the connector's container env (from
  1Password) — never in the worker or Next.js app.
- Egress: fixed base URL / allowlist; block localhost, RFC1918, link-local,
  metadata IPs.
- **Role access is enforced by the worker** (`knowledge_bases.allowed_roles`)
  before the connector is called — the connector also validates inputs.

## Existing

- `kb-docs/` — read-only RAG knowledge base (BM25 over chunks, role-scoped
  libraries). The reference pattern; grounding happens in the worker, not here.
