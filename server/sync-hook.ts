// sync-hook.ts — the todo mirror hook (Vibe post_tool). Reads the hook JSON
// on stdin, which carries `cwd` (the session folder) and the tool call. On a
// todo write it flushes "N: …" item statuses onto ticket N via
// TicketStore.syncStatuses, scoped to the flushing session (rollout_id =
// session folder stem). Fail-open always: the ticket store must never break
// the todo list's flush.
import { TicketStore, ticketDbPath } from "./ticket-store"

interface HookIn {
  cwd?: string
  tool_name?: string
  tool_input?: any
  session_id?: string
}

const data = await new Response(Bun.stdin.stream()).text()
try {
  const hook: HookIn = JSON.parse(data)
  const cfg = (hook.tool_input ?? {}) as { todos?: Array<{ content?: unknown; status?: unknown }> }
  const todos = Array.isArray(cfg.todos) ? cfg.todos : []
  if (!todos.length) process.exit(0)
  // rollout_id = the session id the harness reports, else the session folder
  // stem — stable per session, never caller input.
  const session = hook.session_id ?? (hook.cwd ? hook.cwd.split("/").filter(Boolean).pop()! : "")
  if (!session) process.exit(0)
  const store = new TicketStore(ticketDbPath())
  store.syncStatuses(todos, session)
  store.close()
} catch {
  // fail-open
}
process.exit(0)
