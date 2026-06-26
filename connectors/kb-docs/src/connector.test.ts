import { describe, expect, it } from "vitest"

import { KbDocsConnector } from "./connector.js"
import { TokenBucket } from "./ratelimit.js"
import { parseDoc, type Doc } from "./store.js"

const docs: Doc[] = [
  parseDoc("ventilation", "zagalna", "# Підбір вентилятора\ntags: вентиляція\nтиск і продуктивність."),
  parseDoc("pricing", "finansy", "# Ціна\nмаржа замовлення."),
]

function make(token: string | null = null, bucket?: TokenBucket) {
  return new KbDocsConnector(docs, token, bucket)
}

describe("auth", () => {
  it("denies when token is required but missing/wrong", () => {
    const c = make("secret")
    expect(c.search({ query: "тиск" }, {})).toMatchObject({ ok: false, status: "denied" })
    expect(c.search({ query: "тиск" }, { token: "nope" })).toMatchObject({
      ok: false,
      status: "denied",
    })
  })

  it("allows when token matches", () => {
    const c = make("secret")
    expect(c.search({ query: "тиск" }, { token: "secret" })).toMatchObject({ ok: true })
  })

  it("allows when no token is configured (local/dev)", () => {
    expect(make(null).search({ query: "тиск" }, {})).toMatchObject({ ok: true })
  })
})

describe("schema validation", () => {
  it("rejects empty / oversized / unknown fields", () => {
    const c = make()
    expect(c.search({ query: "" }, {})).toMatchObject({ ok: false, status: "invalid" })
    expect(c.search({ query: "x".repeat(5000) }, {})).toMatchObject({
      ok: false,
      status: "invalid",
    })
    expect(c.search({ query: "тиск", evil: true }, {})).toMatchObject({
      ok: false,
      status: "invalid",
    })
  })

  it("rejects path-traversal-ish ids in fetch", () => {
    const c = make()
    expect(c.fetch({ id: "../secret" }, {})).toMatchObject({ ok: false, status: "invalid" })
    expect(c.fetch({ id: "a/b" }, {})).toMatchObject({ ok: false, status: "invalid" })
  })
})

describe("search / fetch behavior", () => {
  it("returns hits for a valid query", () => {
    const r = make().search({ query: "вентилятор" }, {})
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.resultCount).toBeGreaterThan(0)
  })

  it("fetch returns found:false for unknown id without erroring", () => {
    const r = make().fetch({ id: "nope" }, {})
    expect(r).toMatchObject({ ok: true, resultCount: 0 })
    if (r.ok) expect(r.data).toMatchObject({ found: false })
  })

  it("scopes search to the requested library", () => {
    const r = make().search({ query: "маржа", library: "finansy" }, {})
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.resultCount).toBeGreaterThan(0)
    const none = make().search({ query: "маржа", library: "zagalna" }, {})
    if (none.ok) expect(none.resultCount).toBe(0)
  })

  it("rejects an invalid library id", () => {
    expect(make().search({ query: "маржа", library: "../x" }, {})).toMatchObject({
      ok: false,
      status: "invalid",
    })
  })
})

describe("rate limiting", () => {
  it("rate-limits once the bucket is empty", () => {
    const c = make(null, new TokenBucket(1, 0))
    expect(c.search({ query: "тиск" }, {})).toMatchObject({ ok: true })
    expect(c.search({ query: "тиск" }, {})).toMatchObject({ ok: false, status: "rate_limited" })
  })
})
