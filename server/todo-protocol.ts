// todo — SELF-CONTAINED entry for mistral-vibe (ported from v2.2.1/todo-protocol.ts):
// import-free; bun/node builtins only. The built-in todowrite list is the
// hot, ordered todo list. This store is COLD storage: the durable ticket
// rows plus the GLOBAL SEQUENCER (its autoincrement id is the only global
// ticket number). Framework-free so it can be unit-tested with bun:test.
//
// THE CONTRACT: a ticket is an IMMUTABLE record with an APPEND-ONLY
// comment stream; STATUS is the only field that ever changes. rollout_id
// IS the session id — one id, no other. Access is by ticket number.
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export const STAMP: string = Date.now().toString(36)

export const TODO_PROTOCOL = "" +
`# Todo protocol (mistral-vibe, ported from opencode v2.2.1)

A ticket is an **immutable record with an append-only comment stream; status
is the only field that ever changes.** The todo list is ephemeral ordering.

## The flow: create, comment, change status

1. New task → ticket_add rollout_id=<your session id> todo="one-line
   summary" md_content=<the full spec> → returns the permanent ticket
   number **N**. The body is written ONCE, here — there is no rewrite
   action. The database copy is the record; keep the plan file in the
   repo's gitignored \`.tmp/tickets/NNN_slug.md\` scratch only while
   drafting.
2. todowrite — append item **\`N: <descriptive name>\`** at the END of the
   list. Front-jump only when the user says "do it next" or gives an
   explicit order. Closing the item closes ticket N automatically.
3. Everything after creation is a comment — and a comment is a SHORT
   go/no-go note: done / not done / blocked. Long reports NEVER go on the
   ticket.
4. Status is the only mutation: ticket_status id=N rollout_id=<OWNER
   session id> status=…, or the todo mirror does it for you.
`

export const TODO_STAMP = { stamp: STAMP, seq: 0 }
export const TODO_SEQ = () => { return ++TODO_STAMP.seq }

export const TODOWRITE = "todowrite"

// The authoritative definition of each tool's legal parameters is a JSON
// schema (JTD), not prose. Misuse is unrepresentable: one tool per action,
// additionalProperties:false, so a call missing required params
// or carrying extras fails at the schema layer, before any call is emitted.
export const TODO_PROTOCOL_TOOLS = ["todo_add", "todo_get", "todo_list", "todo_comment", "todo_status", "todo_rules", "todo_help"]

export const audit = (actor: string): string => {
  return `${actor}@${STAMP}`
}
