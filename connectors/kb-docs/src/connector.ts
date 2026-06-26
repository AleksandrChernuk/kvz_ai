import { z } from "zod"

import { emitAudit, type AuditEvent } from "./audit.js"
import { LIMITS } from "./config.js"
import { TokenBucket } from "./ratelimit.js"
import { fetchInput, searchInput } from "./schema.js"
import { buildChunks, getById, search, type Chunk, type Doc } from "./store.js"

export type CallContext = {
  // Token presented by the caller (gateway/worker). Compared to expectedToken.
  token?: string | null
  taskId?: string
  runId?: string
  userRole?: string
}

export type ToolResult =
  | { ok: true; data: unknown; resultCount: number }
  | { ok: false; status: "denied" | "invalid" | "rate_limited" | "error"; error: string }

// Read-only KB connector. Holds the document set + a rate limiter, enforces
// auth/schema/limits, and emits an audit event for every call. No external
// egress — the document store is local, so SSRF does not apply.
export class KbDocsConnector {
  private readonly bucket: TokenBucket
  private readonly chunks: Chunk[]

  constructor(
    private readonly docs: Doc[],
    private readonly expectedToken: string | null,
    bucket?: TokenBucket
  ) {
    this.bucket =
      bucket ?? new TokenBucket(LIMITS.rateCapacity, LIMITS.rateRefillPerSec)
    this.chunks = buildChunks(docs)
  }

  private authOk(ctx: CallContext): boolean {
    if (!this.expectedToken) return true // dev/local: no token configured
    return ctx.token === this.expectedToken
  }

  private run(
    tool: string,
    ctx: CallContext,
    body: () => { data: unknown; resultCount: number }
  ): ToolResult {
    const started = Date.now()
    const audit = (
      status: AuditEvent["status"],
      extra: Partial<Pick<AuditEvent, "resultCount" | "errorClass">> = {}
    ) =>
      emitAudit({
        tool,
        status,
        durationMs: Date.now() - started,
        taskId: ctx.taskId,
        runId: ctx.runId,
        userRole: ctx.userRole,
        ...extra,
      })

    if (!this.authOk(ctx)) {
      audit("denied", { errorClass: "auth" })
      return { ok: false, status: "denied", error: "Невірний або відсутній токен конектора" }
    }
    if (!this.bucket.take()) {
      audit("rate_limited")
      return { ok: false, status: "rate_limited", error: "Перевищено ліміт запитів конектора" }
    }

    try {
      const { data, resultCount } = body()
      audit("ok", { resultCount })
      return { ok: true, data, resultCount }
    } catch (e) {
      if (e instanceof z.ZodError) {
        audit("invalid", { errorClass: "schema" })
        return { ok: false, status: "invalid", error: "Некоректні параметри запиту" }
      }
      audit("error", { errorClass: "internal" })
      return { ok: false, status: "error", error: "Внутрішня помилка конектора" }
    }
  }

  search(rawInput: unknown, ctx: CallContext): ToolResult {
    return this.run("kb_search", ctx, () => {
      const input = searchInput.parse(rawInput)
      const hits = search(this.chunks, input.query, input.limit, input.library)
      return { data: { hits }, resultCount: hits.length }
    })
  }

  fetch(rawInput: unknown, ctx: CallContext): ToolResult {
    return this.run("kb_fetch", ctx, () => {
      const input = fetchInput.parse(rawInput)
      const doc = getById(this.docs, input.id, input.library)
      if (!doc) {
        // Not found is a normal structured result, not an error.
        return { data: { found: false }, resultCount: 0 }
      }
      return {
        data: {
          found: true,
          id: doc.id,
          library: doc.library,
          title: doc.title,
          tags: doc.tags,
          text: doc.text,
        },
        resultCount: 1,
      }
    })
  }
}
