import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { CONNECTOR_KEY, connectorToken, dataDir, LIMITS } from "./config.js"
import { KbDocsConnector, type CallContext } from "./connector.js"
import { loadDocs } from "./store.js"

// Reference read-only KB connector runtime. The correctness-critical logic
// (auth, schema, limits, search, redaction, audit) lives in tested modules;
// this file is only the MCP protocol wiring. In production this runs behind
// ContextForge on an internal network — ContextForge is the auth boundary.

const docs = loadDocs(dataDir())
const token = connectorToken()
const connector = new KbDocsConnector(docs, token)

// In stdio/local mode the gateway is not in front; present the configured
// token so the connector's own auth check passes when CONNECTOR_TOKEN is set.
const localCtx: CallContext = { token }

const server = new McpServer({ name: `kvz-${CONNECTOR_KEY}`, version: "0.1.0" })

server.tool(
  "kb_search",
  "Пошук у внутрішній базі знань КВЗ. Повертає релевантні фрагменти документів.",
  {
    query: z.string().max(LIMITS.maxQueryLength),
    limit: z.number().int().min(1).max(LIMITS.maxResults).optional(),
  },
  async (args) => {
    const res = connector.search(args, localCtx)
    return { content: [{ type: "text", text: JSON.stringify(res) }], isError: !res.ok }
  }
)

server.tool(
  "kb_fetch",
  "Отримати повний документ бази знань за його id.",
  { id: z.string() },
  async (args) => {
    const res = connector.fetch(args, localCtx)
    return { content: [{ type: "text", text: JSON.stringify(res) }], isError: !res.ok }
  }
)

// Stable capability resource (read-only metadata about this connector).
server.resource(
  "capabilities",
  "kb://capabilities",
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          connector: CONNECTOR_KEY,
          class: "read-only-kb",
          tools: ["kb_search", "kb_fetch"],
          document_count: docs.length,
          limits: LIMITS,
        }),
      },
    ],
  })
)

await server.connect(new StdioServerTransport())
