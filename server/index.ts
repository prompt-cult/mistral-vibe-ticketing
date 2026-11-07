// index.ts — MCP stdio entry for the ticketing plugin (Vibe).
// JSON-RPC 2.0 over stdin/stdout: initialize, tools/list, tools/call.
// The seven tools surface with their JSON Schemas; calls are routed to the
// execute* handlers in ticket.ts. context.sessionID comes from
// TICKET_SESSION_ID if the harness injects one, else null.
import {
  executeAdd, executeGet, executeList, executeComment,
  executeStatus, executeRules, executeHelp,
  ADD_INPUT, GET_INPUT, LIST_INPUT, COMMENT_INPUT, STATUS_INPUT, NONE_INPUT,
  ADD_DESC, GET_DESC, LIST_DESC, COMMENT_DESC, STATUS_DESC, RULES_DESC, HELP_DESC,
} from "./ticket"

const decode = new TextDecoder()
let pending = ""
const reader = Bun.stdin.stream().getReader()

const readLine = async (): Promise<string | null> => {
  let i = pending.indexOf("\n")
  while (i === -1) {
    const { done, value } = await reader.read()
    if (done) return pending.trim() ? pending.trim() : null
    pending += decode.decode(value, { stream: true })
    i = pending.indexOf("\n")
  }
  const line = pending.slice(0, i)
  pending = pending.slice(i + 1)
  return line.trim() ? line : null
}

const TOOLS = [
  { name: "ticket_add", description: ADD_DESC, inputSchema: ADD_INPUT },
  { name: "ticket_get", description: GET_DESC, inputSchema: GET_INPUT },
  { name: "ticket_list", description: LIST_DESC, inputSchema: LIST_INPUT },
  { name: "ticket_comment", description: COMMENT_DESC, inputSchema: COMMENT_INPUT },
  { name: "ticket_status", description: STATUS_DESC, inputSchema: STATUS_INPUT },
  { name: "ticket_rules", description: RULES_DESC, inputSchema: NONE_INPUT },
  { name: "ticket_help", description: HELP_DESC, inputSchema: NONE_INPUT },
]

const HANDLERS: Record<string, (args: any, context: any) => Promise<{ content: string }>> = {
  ticket_add: executeAdd,
  ticket_get: executeGet,
  ticket_list: executeList,
  ticket_comment: executeComment,
  ticket_status: executeStatus,
  ticket_rules: executeRules,
  ticket_help: executeHelp,
}

const context = { sessionID: process.env.TICKET_SESSION_ID ?? null }

async function main() {
  while (true) {
    const line = await readLine()
    if (line === null) break
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (!msg || typeof msg.id === "undefined") continue
    let result: unknown
    if (msg.method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ticketing", version: "1.0.0" },
      }
    } else if (msg.method === "notifications/initialized" || msg.method?.startsWith("notifications/")) {
      continue
    } else if (msg.method === "tools/list") {
      result = { tools: TOOLS }
    } else if (msg.method === "tools/call") {
      const fn = HANDLERS[msg.params?.name]
      if (!fn) {
        result = { isError: true, content: [{ type: "text", text: `unknown tool ${msg.params?.name}` }] }
      } else {
        try {
          const r = await fn(msg.params?.arguments ?? {}, context)
          result = { content: [{ type: "text", text: r.content }] }
        } catch (e) {
          result = { isError: true, content: [{ type: "text", text: (e as Error).message }] }
        }
      }
    } else {
      result = {}
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n")
  }
}

main()
