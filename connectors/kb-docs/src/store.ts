import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { LIMITS } from "./config.js"
import { redact } from "./redact.js"

// A library is a folder under the data dir (e.g. data/zvaryuvannya/). Documents
// directly in the data root belong to the "default" library. Each role-scoped
// library maps to one knowledge_bases row in kvz-ai; role access is enforced by
// the worker before this connector is called.

export type Doc = {
  id: string
  library: string
  title: string
  tags: string[]
  text: string
}

export type Chunk = {
  docId: string
  library: string
  title: string
  ordinal: number
  text: string
}

export type SearchHit = {
  docId: string
  library: string
  title: string
  score: number
  snippet: string
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

export function parseDoc(id: string, library: string, raw: string): Doc {
  const lines = raw.split(/\r?\n/)
  let title = id
  const tags: string[] = []
  const body: string[] = []
  for (const line of lines) {
    const h = line.match(/^#\s+(.+)$/)
    const t = line.match(/^tags:\s*(.+)$/i)
    if (h && title === id) {
      title = h[1].trim()
    } else if (t) {
      for (const tag of t[1].split(",")) {
        const v = tag.trim().toLowerCase()
        if (v) tags.push(v)
      }
    } else {
      body.push(line)
    }
  }
  return { id, library, title, tags, text: body.join("\n").trim() }
}

// Split a document into passage chunks on blank lines, packing paragraphs up to
// ~chunkChars so retrieval returns focused passages, not whole documents.
export function chunkDoc(doc: Doc): Chunk[] {
  const paras = doc.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks: Chunk[] = []
  let buf = ""
  const flush = () => {
    if (buf.trim()) {
      chunks.push({
        docId: doc.id,
        library: doc.library,
        title: doc.title,
        ordinal: chunks.length,
        text: `${doc.title}\n${doc.tags.join(" ")}\n${buf.trim()}`,
      })
      buf = ""
    }
  }
  for (const p of paras) {
    if (buf.length + p.length > LIMITS.chunkChars && buf) flush()
    buf = buf ? `${buf}\n\n${p}` : p
  }
  flush()
  if (chunks.length === 0) {
    chunks.push({
      docId: doc.id,
      library: doc.library,
      title: doc.title,
      ordinal: 0,
      text: `${doc.title}\n${doc.tags.join(" ")}`,
    })
  }
  return chunks
}

export function loadDocs(dir: string): Doc[] {
  const docs: Doc[] = []
  const readDir = (path: string, library: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry)
      if (statSync(full).isDirectory()) {
        readDir(full, entry) // subfolder name = library
        continue
      }
      if (!entry.endsWith(".md") && !entry.endsWith(".txt")) continue
      const id = entry.replace(/\.(md|txt)$/i, "")
      docs.push(parseDoc(id, library, readFileSync(full, "utf8")))
    }
  }
  readDir(dir, "default")
  return docs
}

export function buildChunks(docs: Doc[]): Chunk[] {
  return docs.flatMap(chunkDoc)
}

// --- BM25 retrieval over chunks --------------------------------------------

const K1 = 1.5
const B = 0.75

function snippetFor(text: string, terms: Set<string>): string {
  const body = text.split("\n").slice(2).join("\n") || text
  const lower = body.toLowerCase()
  let pos = -1
  for (const term of terms) {
    const i = lower.indexOf(term)
    if (i >= 0 && (pos === -1 || i < pos)) pos = i
  }
  const start = pos > 60 ? pos - 60 : 0
  const raw = body.slice(start, start + LIMITS.maxSnippetChars).trim()
  return redact((start > 0 ? "…" : "") + raw)
}

// Term match with prefix tolerance for inflected forms (укр. відмінки).
function matches(token: string, term: string): boolean {
  return (
    token === term ||
    (term.length >= 4 && (token.startsWith(term) || term.startsWith(token)))
  )
}

export function search(
  chunks: Chunk[],
  query: string,
  limit: number,
  library?: string
): SearchHit[] {
  const scope = library ? chunks.filter((c) => c.library === library) : chunks
  if (scope.length === 0) return []

  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return []

  const docTokens = scope.map((c) => tokenize(c.text))
  // `|| 1` guards a tiny library whose chunks all tokenize to nothing.
  const avgLen =
    docTokens.reduce((s, t) => s + t.length, 0) / scope.length || 1

  // Document frequency per term (prefix-aware).
  const df = new Map<string, number>()
  for (const term of terms) {
    let n = 0
    for (const toks of docTokens) {
      if (toks.some((t) => matches(t, term))) n++
    }
    df.set(term, n)
  }

  const N = scope.length
  const hits: SearchHit[] = scope.map((chunk, i) => {
    const toks = docTokens[i]
    const len = toks.length || 1
    let score = 0
    for (const term of terms) {
      const tf = toks.filter((t) => matches(t, term)).length
      if (tf === 0) continue
      const n = df.get(term) ?? 0
      // Floor the idf so a term present in every chunk of a small library still
      // contributes (otherwise the most topical term can score ~0 and drop out).
      const idf = Math.max(0.05, Math.log(1 + (N - n + 0.5) / (n + 0.5)))
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avgLen)))
    }
    return {
      docId: chunk.docId,
      library: chunk.library,
      title: chunk.title,
      score,
      snippet: snippetFor(chunk.text, new Set(terms)),
    }
  })

  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.docId.localeCompare(b.docId))
    .slice(0, limit)
}

export function getById(docs: Doc[], id: string, library?: string): Doc | null {
  return (
    docs.find((d) => d.id === id && (!library || d.library === library)) ?? null
  )
}

export function listLibraries(docs: Doc[]): string[] {
  return [...new Set(docs.map((d) => d.library))].sort()
}
