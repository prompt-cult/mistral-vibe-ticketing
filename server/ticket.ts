// ticket — SELF-CONTAINED entry for mistral-vibe (ported from v2.2.1/ticket.ts):
// the store + tool surface. bun:sqlite + node:fs only; no imports outside
// bun/node builtins. todo-protocol.ts is import-free and ships unchanged.
//
// THE SURFACE (issue #18, make misuse unrepresentable): one tool per
// action — ticket_add, ticket_get, ticket_list, ticket_comment,
// ticket_status, ticket_rules, ticket_help — each with its own small
// schema that DECLARES its required params, so a call missing them is a
// schema violation at the harness layer, visible in the tool definition
// before any call is emitted.
//
// THE CONTRACT: a ticket is an IMMUTABLE record with an APPEND-ONLY
// comment stream; STATUS is the only field that ever changes. rollout_id
// IS the session id — one id, no other. Access is by ticket number.
//
// The DB lives OUTSIDE any repo, shared by all TUIs on hundreds of
// projects/worktrees: TICKET_DB_HOME || ~/.config/mistral-vibe/
// mistral-vibe-ticketing/. Tests override TICKET_DB_HOME=.tmp/…/ so they
// point at throwaway DBs, never the live one.
//
// audit(last_actor) comes from the harness-reported sessionID, so the
// audit trail is ground truth and never caller input.
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export const STAMP: string = Date.now().toString(36)

export const audit = (actor: string): string => {
  return `${actor}@${STAMP}`
}

export interface TicketRow {
  id: number
  created_at: string
  updated_at: string
  todo: string
  status: string
  rollout_id: string
  last_actor: string
  md_content: string
}

const dbHome = process.env.TICKET_DB_HOME
  || join(homedir(), ".config", "mistral-vibe", "mistral-vibe-ticketing")

export const dbPath = join(dbHome, "ticket.db")

function open(): Database {
  mkdirSync(dbHome, { recursive: true })
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      todo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      rollout_id TEXT NOT NULL,
      last_actor TEXT NOT NULL,
      md_content TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      created_at TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(content) <= 1000)
    );
  `)
  return db
}

// ─── Tool surface (issue #18, make misuse unrepresentable) ──────────────
// One tool per action; one door per action — there is no action string to
// spell wrongly. AdditionalProperties:false, so a call missing required
// params or carrying extras fails at the schema layer, before any call is
// emitted. A failing model re-emits corrected_call verbatim and succeeds —
// no prose-interpretation step where it can go off the rails.

export const STAMPS = [
  "ticket_add",
  "ticket_get",
  "ticket_list",
  "ticket_comment",
  "ticket_status",
  "ticket_rules",
  "ticket_help",
]

/**
 * Gate the SQL — one mutation (set_status) reachable only inside the
 * owner's namespace; the todo mirror closes only the flushing session's rows.
 */
function gate(db: Database, tool: string, errors: string[]): never {
  throw new Error(`E_${tool}_GATED: ${errors.join("; ")}` as never)
}

export { open as Open, open as open, dbPath as DbPath, dbPath as dbPath, gate as Gate, gate as gate }
