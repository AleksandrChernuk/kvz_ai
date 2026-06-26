// Retrieval CLI for the worker's grounding step.
//
//   node dist/query-cli.js --query "..." [--library <lib>] [--limit n]
//
// Prints JSON `{ ok, hits: [{docId, library, title, snippet}] }` to stdout and
// exits 0 on success, non-zero otherwise. This is a thin wrapper over the same
// tested connector core the MCP server uses. kb-docs has no secrets and no
// external egress, so a direct local call is acceptable for the low-sensitivity
// KB; sensitive connectors (Bitrix/1C) must route through ContextForge instead.

import { connectorToken, dataDir, LIMITS } from "./config.js"
import { KbDocsConnector } from "./connector.js"
import { loadDocs } from "./store.js"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const query = arg("query")
if (!query) {
  process.stderr.write("usage: query-cli --query <text> [--library <lib>] [--limit n]\n")
  process.exit(2)
}

const library = arg("library")
const limit = Math.min(Number(arg("limit") ?? "4") || 4, LIMITS.maxResults)

const token = connectorToken()
const connector = new KbDocsConnector(loadDocs(dataDir()), token)
const res = connector.search({ query, library, limit }, { token })

process.stdout.write(JSON.stringify(res))
process.exit(res.ok ? 0 : 1)
