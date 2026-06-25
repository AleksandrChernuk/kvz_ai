import { describe, expect, it } from "vitest"

import { getById, parseDoc, search, type Doc } from "./store.js"

const docs: Doc[] = [
  parseDoc(
    "ventilation",
    "# Підбір вентилятора\ntags: вентиляція, підбір\nРобоча точка: тиск і продуктивність."
  ),
  parseDoc("pricing", "# Розрахунок ціни\ntags: ціна\nЦіна та маржа замовлення."),
]

describe("parseDoc", () => {
  it("extracts title, tags and body", () => {
    const d = docs[0]
    expect(d.title).toBe("Підбір вентилятора")
    expect(d.tags).toContain("вентиляція")
    expect(d.text).toContain("Робоча точка")
    expect(d.text).not.toContain("# Підбір")
  })
})

describe("search", () => {
  it("ranks matching docs and returns snippets", () => {
    const hits = search(docs, "вентилятор тиск", 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].id).toBe("ventilation")
    expect(hits[0].snippet.length).toBeGreaterThan(0)
  })

  it("weights title matches above body matches", () => {
    const hits = search(docs, "ціна", 5)
    expect(hits[0].id).toBe("pricing")
  })

  it("returns nothing for an empty/garbage query", () => {
    expect(search(docs, "   ", 5)).toEqual([])
    expect(search(docs, "zzzznotaword", 5)).toEqual([])
  })

  it("respects the limit", () => {
    expect(search(docs, "ціна вентилятор", 1).length).toBe(1)
  })
})

describe("getById", () => {
  it("returns the doc or null", () => {
    expect(getById(docs, "pricing")?.title).toBe("Розрахунок ціни")
    expect(getById(docs, "missing")).toBeNull()
  })
})
