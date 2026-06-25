import { CONNECTOR_KEY } from "./config.js"

// Structured audit event for every tool call. No secrets, no raw payloads,
// no token contents — only metadata (connector-standard: audit logging).

export type AuditEvent = {
  ts: string
  connector: string
  tool: string
  status: "ok" | "denied" | "invalid" | "rate_limited" | "error"
  durationMs: number
  resultCount?: number
  // Caller context passed by the gateway/worker, when available.
  taskId?: string
  runId?: string
  userRole?: string
  errorClass?: string
}

export function emitAudit(
  e: Omit<AuditEvent, "ts" | "connector">,
  sink: (line: string) => void = (l) => process.stderr.write(l + "\n")
): void {
  const event: AuditEvent = {
    ts: new Date().toISOString(),
    connector: CONNECTOR_KEY,
    ...e,
  }
  sink(JSON.stringify(event))
}
