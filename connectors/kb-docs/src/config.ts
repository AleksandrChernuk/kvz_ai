// Connector limits and runtime config. Read-only KB connector: no external
// egress (serves a local document store), so SSRF is not applicable here —
// documented explicitly per the connector standard.

export const CONNECTOR_KEY = "kb-docs"

export const LIMITS = {
  // Strict input bounds (connector-standard: query/result limits).
  maxQueryLength: 500,
  maxResults: 10,
  defaultResults: 5,
  maxSnippetChars: 400,
  // Token-bucket rate limit per connector process.
  rateCapacity: 30,
  rateRefillPerSec: 10,
  // Per-tool timeout budget (advisory; the store is in-memory so calls are fast).
  toolTimeoutMs: 5000,
} as const

// Optional bearer token. When set, tool calls must present it (auth deny path).
// In production ContextForge injects it; locally it may be unset for dev.
export function connectorToken(): string | null {
  const t = process.env.CONNECTOR_TOKEN
  return t && t.length > 0 ? t : null
}

// Directory holding the knowledge-base documents (markdown/text).
export function dataDir(): string {
  return process.env.KB_DOCS_DIR ?? new URL("../data", import.meta.url).pathname
}
