#!/usr/bin/env node
// Operational helper for the PleasePrompto notebooklm-mcp connector (stdio).
// Not used by the worker at runtime (the worker drives the connector through
// Codex) — this is for one-time auth setup and for listing notebooks when
// wiring role→notebook access rows.
//
// Usage:
//   node mcp_client.mjs setup   # opens Chrome, log in once (persistent profile)
//   node mcp_client.mjs list    # print list_notebooks (read-only)
//
// Auth persists in the connector's Chrome profile
// (~/Library/Application Support/notebooklm-mcp/chrome_profile/ on macOS),
// so `list` works headless after a successful `setup`.
import { spawn } from "node:child_process";

const PKG = process.env.NOTEBOOKLM_MCP_PACKAGE || "notebooklm-mcp@2.0.0";
const mode = process.argv[2] || "list";

const child = spawn("npx", ["-y", PKG], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buf = "";
const pending = new Map();
let nextId = 1;

const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
const callTool = (name, args = {}) => rpc("tools/call", { name, arguments: args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (r) => { try { return r.content.map((c) => c.text).join("\n"); } catch { return JSON.stringify(r); } };

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[srv] " + d.toString()));

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "kvz-nb-helper", version: "0.1.0" },
  });
  notify("notifications/initialized", {});

  if (mode === "setup") {
    console.error(">>> setup_auth — відкриється вікно Chrome. Залогінься у Google (Workspace).");
    console.error(">>> " + textOf(await callTool("setup_auth", { show_browser: true })));
    console.error(">>> Чекаю логін, опитую list_notebooks (до 8 хв)...");
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(6000);
      let res; try { res = await callTool("list_notebooks", {}); } catch { process.stderr.write("x"); continue; }
      const t = textOf(res);
      if (res.isError || /not authenticated|login|expired/i.test(t)) { process.stderr.write("."); continue; }
      console.error("\n=== list_notebooks OK ===");
      console.log(t);
      return 0;
    }
    console.error("\nТаймаут: не дочекався успішного list_notebooks.");
    return 1;
  }

  // mode === "list"
  const res = await callTool("list_notebooks", {});
  const t = textOf(res);
  console.log(t);
  return res.isError ? 1 : 0;
}

main()
  .then((code) => { child.kill("SIGKILL"); process.exit(code); })
  .catch((e) => { console.error("ERROR:", e.message); child.kill("SIGKILL"); process.exit(1); });
