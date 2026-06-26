import { describe, expect, it } from "vitest"

import { dataDir } from "./config.js"
import {
  buildChunks,
  chunkDoc,
  getById,
  listLibraries,
  loadDocs,
  parseDoc,
  search,
  type Doc,
} from "./store.js"

const docs: Doc[] = [
  parseDoc(
    "ventilation",
    "zagalna",
    "# Підбір вентилятора\ntags: вентиляція, підбір\nРобоча точка: тиск і продуктивність.\n\nДіаметр колеса підбирають за тиском."
  ),
  parseDoc(
    "pricing",
    "finansy",
    "# Розрахунок ціни\ntags: ціна\nЦіна та маржа замовлення формуються за конфігурацією."
  ),
  parseDoc(
    "welding",
    "zvaryuvannya",
    "# Зварювальні матеріали\ntags: зварювання\nЕлектроди підбирають за товщиною металу."
  ),
]

const chunks = buildChunks(docs)

describe("parseDoc", () => {
  it("extracts title, tags, body and library", () => {
    const d = docs[0]
    expect(d.title).toBe("Підбір вентилятора")
    expect(d.library).toBe("zagalna")
    expect(d.tags).toContain("вентиляція")
    expect(d.text).not.toContain("# Підбір")
  })
})

describe("chunkDoc", () => {
  it("splits a doc into passages and always yields at least one chunk", () => {
    expect(chunkDoc(docs[0]).length).toBeGreaterThanOrEqual(1)
    const empty = parseDoc("e", "zagalna", "# Title only")
    expect(chunkDoc(empty).length).toBe(1)
  })
})

describe("search (BM25)", () => {
  it("ranks matching chunks and returns snippets", () => {
    const hits = search(chunks, "вентилятор тиск", 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].docId).toBe("ventilation")
    expect(hits[0].snippet.length).toBeGreaterThan(0)
  })

  it("scopes results to a single library", () => {
    const hits = search(chunks, "ціна маржа", 5, "finansy")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.library === "finansy")).toBe(true)
  })

  it("returns nothing when the library has no match", () => {
    expect(search(chunks, "ціна", 5, "zvaryuvannya")).toEqual([])
  })

  it("returns nothing for an empty / garbage query", () => {
    expect(search(chunks, "   ", 5)).toEqual([])
    expect(search(chunks, "zzzznotaword", 5)).toEqual([])
  })

  it("respects the limit", () => {
    expect(search(chunks, "ціна вентилятор зварювання", 1).length).toBe(1)
  })
})

describe("getById / listLibraries", () => {
  it("fetches by id, optionally scoped to a library", () => {
    expect(getById(docs, "pricing")?.title).toBe("Розрахунок ціни")
    expect(getById(docs, "pricing", "zvaryuvannya")).toBeNull()
    expect(getById(docs, "missing")).toBeNull()
  })

  it("lists distinct libraries", () => {
    expect(listLibraries(docs)).toEqual(["finansy", "zagalna", "zvaryuvannya"])
  })
})

describe("library/folder drift guard", () => {
  // The data/<folder> set must match the libraries seeded by migration 018.
  // A mismatch means a knowledge_bases row points at a missing folder (silent
  // empty retrieval) or a folder is orphaned (unreachable docs).
  it("data folders match the seeded knowledge_bases libraries", () => {
    expect(listLibraries(loadDocs(dataDir()))).toEqual([
      "finansy",
      "zagalna",
      "zvaryuvannya",
    ])
  })
})
