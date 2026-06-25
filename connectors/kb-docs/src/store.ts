import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { LIMITS } from "./config.js"
import { redact } from "./redact.js"

export type Doc = {
  id: string
  title: string
  tags: string[]
  text: string
}

export type SearchHit = {
  id: string
  title: string
  score: number
  snippet: string
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

// Parse a `<id>.md` file: first `# Heading` is the title, an optional
// `tags: a, b` line sets tags, the remainder is the body.
export function parseDoc(id: string, raw: string): Doc {
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
  return { id, title, tags, text: body.join("\n").trim() }
}

export function loadDocs(dir: string): Doc[] {
  const docs: Doc[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md") && !file.endsWith(".txt")) continue
    const id = file.replace(/\.(md|txt)$/i, "")
    docs.push(parseDoc(id, readFileSync(join(dir, file), "utf8")))
  }
  return docs
}

function snippetFor(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  let pos = -1
  for (const term of terms) {
    const i = lower.indexOf(term)
    if (i >= 0 && (pos === -1 || i < pos)) pos = i
  }
  const start = pos > 60 ? pos - 60 : 0
  const raw = text.slice(start, start + LIMITS.maxSnippetChars).trim()
  return redact((start > 0 ? "…" : "") + raw)
}

// Term-frequency scoring over title (weighted) + body. Deterministic.
export function search(docs: Doc[], query: string, limit: number): SearchHit[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return []

  const hits: SearchHit[] = []
  for (const doc of docs) {
    const titleTokens = tokenize(doc.title)
    const bodyTokens = tokenize(`${doc.text} ${doc.tags.join(" ")}`)
    // Prefix match handles inflection (укр. відмінки): "вентилятор" ~ "вентилятора".
    const matches = (t: string, term: string) =>
      t === term || (term.length >= 4 && (t.startsWith(term) || term.startsWith(t)))
    let score = 0
    for (const term of terms) {
      score += titleTokens.filter((t) => matches(t, term)).length * 3
      score += bodyTokens.filter((t) => matches(t, term)).length
    }
    if (score > 0) {
      hits.push({
        id: doc.id,
        title: doc.title,
        score,
        snippet: snippetFor(doc.text, terms),
      })
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export function getById(docs: Doc[], id: string): Doc | null {
  return docs.find((d) => d.id === id) ?? null
}
