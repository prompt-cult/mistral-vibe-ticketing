// ticket.ts — the tool surface, ported from opencode-ticketing v2.2.1 to a
// Vibe MCP server. One tool per action, per-tool required schemas, and the
// {code, message, corrected_call} envelope on every failure path (issue #18).
// ticket-store.ts ships the store; no opencode imports anywhere.
//
// THE CONTRACT: a ticket is an IMMUTABLE record with an APPEND-ONLY comment
// stream; STATUS is the only field that ever changes. rollout_id IS the
// session id — one id, no other. Access is by ticket number.
import { TicketStore, STATUSES, ticketDbPath } from "./ticket-store"

export {
  TicketStore, STATUSES, ticketDbPath,
  type TicketRow, type TicketComment, type AddInput, type SetStatusInput, type ListFilter,
} from "./ticket-store"

const STATUS_ENUM = ["pending", "in_progress", "completed", "cancelled", "superseded"]

let _store: TicketStore | null = null
export function getStore(): TicketStore {
  if (!_store) _store = new TicketStore(ticketDbPath())
  return _store
}

// ─── Structured error envelope (issue #18) ────────────────────────────────
// Every failure returns {code, message, corrected_call}. corrected_call is
// the COMPLETE args object: received values kept, missing ones filled — the
// REAL owner session id where the ticket is known, a "<fill: …>" placeholder
// only where nothing can be derived. A failing model re-emits it verbatim.

const HELP_HINT = " — recover with one call: ticket_help"

export function fail(code: string, message: string, correctedCall: Record<string, unknown>): { content: string } {
  return { content: JSON.stringify({ code, message: message + HELP_HINT, corrected_call: correctedCall }, null, 2) }
}

function ok(payload: unknown): { content: string } {
  return { content: JSON.stringify(payload, null, 2) }
}

// Parsed envelope or null — for tests and callers that want the structure.
export function parseEnvelope(content: string): { code: string; message: string; corrected_call: Record<string, unknown> } | null {
  try {
    const o = JSON.parse(content)
    if (typeof o?.code === "string" && typeof o?.message === "string" && o?.corrected_call && typeof o.corrected_call === "object") return o
    return null
  } catch {
    return null
  }
}

// ─── RFC 8927 legal parameter sets (issue #18) ────────────────────────────
// The authoritative definition of each tool's legal parameters is a JSON
// Type Definition schema (RFC 8927). JTD rejects additional members by
// default, so the legal set IS the schema: anything not declared here is
// a validation error before the handler runs. Hand-inlined so the entry
// stays self-contained. Regenerate with `jtd-codegen --target js <tool>.json`.

export const ADD_JTD = {
  properties: { rollout_id: { type: "string" }, todo: { type: "string" } },
  optionalProperties: { md_content: { type: "string" } },
}

export const GET_JTD = { properties: { id: { type: "uint32" } } }

// list's params are individually optional; the rollout_id-OR-all rule is
// the runtime check (it owns the self-healing corrected_call).
export const LIST_JTD = {
  optionalProperties: {
    rollout_id: { type: "string" },
    status: { enum: ["pending", "in_progress", "completed", "cancelled", "superseded"] },
    all: { type: "boolean" },
  },
}

export const COMMENT_JTD = { properties: { id: { type: "uint32" }, content: { type: "string" } } }

export const STATUS_JTD = {
  properties: {
    id: { type: "uint32" },
    rollout_id: { type: "string" },
    status: { enum: ["pending", "in_progress", "completed", "cancelled", "superseded"] },
  },
}

export const NONE_JTD = { properties: {} }

export function jtdValidateAdd(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/properties" })
  } else {
    if (!("rollout_id" in instance) || instance["rollout_id"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/rollout_id" })
    else {
      if (typeof instance["rollout_id"] !== "string") e.push({ instancePath: "/rollout_id", schemaPath: "/properties/rollout_id/type" })
    }
    if (!("todo" in instance) || instance["todo"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/todo" })
    else {
      if (typeof instance["todo"] !== "string") e.push({ instancePath: "/todo", schemaPath: "/properties/todo/type" })
    }
    if ("md_content" in instance && instance["md_content"] !== undefined) {
      if (typeof instance["md_content"] !== "string") e.push({ instancePath: "/md_content", schemaPath: "/optionalProperties/md_content/type" })
    }
    for (const k in instance) {
      if (k !== "rollout_id" && k !== "todo" && k !== "md_content") e.push({ instancePath: "/" + k, schemaPath: "" })
    }
  }
  return e
}

export function jtdValidateGet(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/properties" })
  } else {
    if (!("id" in instance) || instance["id"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/id" })
    else {
      if (typeof instance["id"] !== "number" || !Number.isInteger(instance["id"]) || instance["id"] < 0 || instance["id"] > 4294967295) e.push({ instancePath: "/id", schemaPath: "/properties/id/type" })
    }
    for (const k in instance) {
      if (k !== "id") e.push({ instancePath: "/" + k, schemaPath: "" })
    }
  }
  return e
}

export function jtdValidateList(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/optionalProperties" })
  } else {
    if ("all" in instance && instance["all"] !== undefined) {
      if (typeof instance["all"] !== "boolean") e.push({ instancePath: "/all", schemaPath: "/optionalProperties/all/type" })
    }
    if ("rollout_id" in instance && instance["rollout_id"] !== undefined) {
      if (typeof instance["rollout_id"] !== "string") e.push({ instancePath: "/rollout_id", schemaPath: "/optionalProperties/rollout_id/type" })
    }
    if ("status" in instance && instance["status"] !== undefined) {
      if (typeof instance["status"] !== "string" || !STATUS_ENUM.includes(instance["status"])) e.push({ instancePath: "/status", schemaPath: "/optionalProperties/status/enum" })
    }
    for (const k in instance) {
      if (k !== "all" && k !== "rollout_id" && k !== "status") e.push({ instancePath: "/" + k, schemaPath: "" })
    }
  }
  return e
}

export function jtdValidateComment(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/properties" })
  } else {
    if (!("content" in instance) || instance["content"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/content" })
    else {
      if (typeof instance["content"] !== "string") e.push({ instancePath: "/content", schemaPath: "/properties/content/type" })
    }
    if (!("id" in instance) || instance["id"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/id" })
    else {
      if (typeof instance["id"] !== "number" || !Number.isInteger(instance["id"]) || instance["id"] < 0 || instance["id"] > 4294967295) e.push({ instancePath: "/id", schemaPath: "/properties/id/type" })
    }
    for (const k in instance) {
      if (k !== "content" && k !== "id") e.push({ instancePath: "/" + k, schemaPath: "" })
    }
  }
  return e
}

export function jtdValidateStatus(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/properties" })
  } else {
    if (!("id" in instance) || instance["id"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/id" })
    else {
      if (typeof instance["id"] !== "number" || !Number.isInteger(instance["id"]) || instance["id"] < 0 || instance["id"] > 4294967295) e.push({ instancePath: "/id", schemaPath: "/properties/id/type" })
    }
    if (!("rollout_id" in instance) || instance["rollout_id"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/rollout_id" })
    else {
      if (typeof instance["rollout_id"] !== "string") e.push({ instancePath: "/rollout_id", schemaPath: "/properties/rollout_id/type" })
    }
    if (!("status" in instance) || instance["status"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/status" })
    else {
      if (typeof instance["status"] !== "string" || !STATUS_ENUM.includes(instance["status"])) e.push({ instancePath: "/status", schemaPath: "/properties/status/enum" })
    }
    for (const k in instance) {
      if (k !== "id" && k !== "rollout_id" && k !== "status") e.push({ instancePath: "/" + k, schemaPath: "" })
    }
  }
  return e
}

export function jtdValidateNone(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/optionalProperties" })
  } else {
    for (const k in instance) {
      e.push({ instancePath: "/" + k, schemaPath: "" })
    }
  }
  return e
}

// jtdFail maps a JTD error onto the stable envelope codes (issue #18):
// missing required param → E_<TOOL>_MISSING_<PARAM>; wrong type or illegal
// enum value → E_<TOOL>_BAD_<PARAM>; unknown key → E_<TOOL>_EXTRA_PROPERTY.
function jtdFail(tool: string, errors: any[], corrected: Record<string, unknown>): { content: string } {
  const first = errors[0]
  const lower = tool.toLowerCase()
  const missing = /^\/properties\/(\w+)$/.exec(first.schemaPath || "")
  if (missing)
    return fail(`E_${tool}_MISSING_${missing[1].toUpperCase()}`, `ticket_${lower} requires '${missing[1]}'`, corrected)
  const bad = /^\/properties\/(\w+)\/(type|enum)$/.exec(first.schemaPath || "")
  if (bad) {
    const what =
      bad[2] === "enum"
        ? `ticket_${lower}: '${bad[1]}' is not one of the legal values (${STATUS_ENUM.join("|")})`
        : `ticket_${lower}: '${bad[1]}' has the wrong type`
    return fail(`E_${tool}_BAD_${bad[1].toUpperCase()}`, what, corrected)
  }
  const extra = /^\/(\w+)$/.exec(first.instancePath || "")
  if ((first.schemaPath || "") === "" && extra)
    return fail(
      `E_${tool}_EXTRA_PROPERTY`,
      `'${extra[1]}' is not a legal parameter of ticket_${lower} — the legal set is exactly its declared params`,
      corrected,
    )
  return fail(`E_${tool}_NOT_AN_OBJECT`, `ticket_${lower} takes an object with exactly its declared params`, corrected)
}

// ─── Per-tool schemas: misuse is unrepresentable (issue #18) ───────────────
// Each tool declares its own required params and additionalProperties:false,
// so junk keys and missing params are schema violations at the harness layer,
// visible in the tool definition before any call is emitted.

export const ADD_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    rollout_id: { type: "string", description: "YOUR session id (on Vibe, a hand-picked per-session rollout id, e.g. vibe-<date>-<topic>)" },
    todo: { type: "string", description: "one-line summary" },
    md_content: { type: "string", description: "the spec, written ONCE at creation — the immutable body" },
  },
  required: ["rollout_id", "todo"],
}

export const GET_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "number", description: "ticket number" },
  },
  required: ["id"],
}

export const LIST_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    rollout_id: { type: "string", description: "the session id to query" },
    status: { type: "string", description: "pending | in_progress | completed | cancelled | superseded (filter)" },
    all: { type: "boolean", description: "list every session's tickets (instead of one session's)" },
  },
  oneOf: [{ required: ["rollout_id"] }, { required: ["all"] }],
}

export const COMMENT_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "number", description: "ticket number" },
    content: {
      type: "string",
      maxLength: 1000,
      description: "short go/no-go note: done / not done / blocked — 1000 chars max",
    },
  },
  required: ["id", "content"],
}

export const STATUS_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "number", description: "ticket number" },
    rollout_id: { type: "string", description: "the ticket's OWNING session id" },
    status: { type: "string", description: "pending | in_progress | completed | cancelled | superseded" },
  },
  required: ["id", "rollout_id", "status"],
}

export const NONE_INPUT = { type: "object", additionalProperties: false, properties: {} }

// ─── Per-tool descriptions ─────────────────────────────────────────────────

export const ADD_DESC = `Create a ticket. rollout_id = YOUR session id; todo = the one-line summary;
md_content = the spec, written ONCE here (the immutable body). Returns the
permanent ticket number N — use it as the todo item number ("N: …").`

export const GET_DESC = `Read one ticket: the row (id, created, updated, todo, status, owner session
id, last_actor, md_content) plus its comments, oldest first. Reads are by
ticket number — no session id needed.`

export const LIST_DESC = `List tickets. rollout_id = the session id to query (required — an agent
must know which session it is querying); status filters; all=true lists
every session's tickets instead.`

export const COMMENT_DESC = `Append ONE comment to a ticket: a short go/no-go note — done / not done /
blocked — 1000 chars max. Long reports NEVER go on the ticket (final response
or a gist). Any session may append; the author is your session, stamped
automatically. No session id needed — access is by ticket number.`

export const STATUS_DESC = `The ONLY mutation: set a ticket's status
(pending|in_progress|completed|cancelled|superseded). rollout_id = the
ticket's OWNING session id. Closing the todo item "N: …" does this
automatically; this tool covers the rest. To supersede: set the status and
name the replacement ticket in a comment.`

export const RULES_DESC = `The delegatee banner: who you are (DELEGATEE), the immutability law, your
only writes, and the standing subagent rules. A launched subagent's second
call, after ticket_get.`

export const HELP_DESC = `The whole ticket contract in one call: the tools and their required
params, the session-id doctrine, statuses, delegation, and the error
envelope. The recovery for a lost agent.`

// ─── The contract text ──────────────────────────────────────────────────────

export function helpText(): string {
  return `ticket — the whole contract (one call to recover it)

A ticket is an IMMUTABLE record with an APPEND-ONLY comment stream; STATUS is
the only field that ever changes. One tool per action — there is no action
string to spell wrongly; each tool's schema declares its required params:

- ticket_add rollout_id=<your session id> todo="one-line summary"
  [md_content=spec] -> creates the ticket; returns the permanent ticket
  number N. The body (md_content) is written ONCE, here — never after.
- ticket_get id=N -> the row + its comments (chronological).
- ticket_list rollout_id=<session id> [status=<status>] -> ONE session's
  tickets; all=true -> every session's. The session id is required — an
  agent must know which session it is querying.
- ticket_comment id=N content="..." -> the ONLY write after creation: a
  SHORT go/no-go note — done / not done / blocked — 1000 chars max. Long
  reports NEVER go on the ticket: detail lives in your final response (or a
  gist). Any session may append (the author is your session, stamped
  automatically).
- ticket_status id=N rollout_id=<OWNER session id> status=<pending|
  in_progress|completed|cancelled|superseded> -> the ONLY mutation.
  Owner-gated. The todo mirror sets ticket N's status automatically whenever
  the todo item "N: …" changes.
- ticket_rules -> the DELEGATEE's banner (its second call, after
  ticket_get).
- ticket_help -> this text.

The session id: rollout_id IS the session id — one id, no other. On Vibe
it is a hand-picked per-session rollout id (e.g. vibe-<date>-<topic>),
not a "ses_…" id.
- You MUST know your own session id. ticket_add and ticket_list take YOUR
  session id by default; ticket_status takes the ticket owner's.
- When delegating, NAME the session id the delegatee must use — it uses
  THAT id on ticket_status and ticket_list.
- To find tickets by another session (to adopt):
  ticket_list rollout_id=<that session id>.
- Access is by ticket number everywhere else: ticket_get id=N,
  ticket_comment id=N. Too simple to get wrong.

WHO DOES WHAT (delegation):
- The DELEGATOR (main agent) creates the ticket — body self-contained before
  launch — and hands the subagent ONLY the ticket number. It owns the session
  id. It does NOT call ticket_rules.
- The DELEGATEE (subagent) first two calls are READS: ticket_get id=N, then
  ticket_rules. It NEVER edits the ticket — there is no rewrite action. It
  needs NO write to start work. It reports via short comments
  (ticket_comment id=N content=...) and, when done, ticket_status with the
  OWNER's session id.
- The DELEGATOR reviews the diff, runs the tests, commits.

Errors: every failure returns {code, message, corrected_call}. corrected_call
is the COMPLETE call — your received values kept, the missing ones filled
(the REAL owner session id wherever the ticket is known). Re-emit it
verbatim (fill any "<fill: …>" placeholder) and the call succeeds.

Mark-complete vs drop: a subagent MARKS its todo item / the ticket done; only
the ORCHESTRATOR removes todo items. Nothing is ever deleted — there is no
delete action. Never read the SQLite file directly — the tools are the API.`
}

function rulesText(): string {
  return `WHO YOU ARE: you are the DELEGATEE — a subagent launched by the main agent
(the DELEGATOR), which created the ticket and handed you ONLY its number. The
rules below are for YOU; the delegator does not read them. Your first two
calls: ticket_get id=N (your instructions), then this read (you are doing it
now). THE TICKET IS IMMUTABLE: the body was written once by the delegator
before your launch — there is no rewrite action, and NO write to the ticket
is a prerequisite for starting work: read the ticket, read these rules, then
DO THE WORK. Your only writes are ticket_comment notes — SHORT go/no-go:
done / not done / blocked, 1000 chars max — and, when the work is done,
ticket_status with the OWNER's session id — your launch prompt NAMES it; use
it. Long reports NEVER go on the ticket: put the detail in your final
response to the orchestrator (or a gist). The DELEGATOR reviews the diff,
runs the tests, and commits — you do not.

Subagent (delegee) rules — obey all of them:
- Read the repo's AGENTS.md if it exists and obey it.
- No commit, no push, no PR creation, no watch/poll of CI.
- Only run tests and \`git add\`.
- No rm/reset/stash — mv to .tmp; no /tmp.
- No issue numbers in committed files, messages, docs, comments.
- EN/CN doc parity for any doc touched.
- Tee all command output to .tmp/clobber_me_NN.txt (incrementing).
- bare-env macOS proof: env -u HOMEBREW_PREFIX -u PKG_CONFIG_PATH.
- AppVeyor checks are orphaned (ignore).
- When extra work is discovered, record it in the ticket (ticket_comment) —
  do not chase it.
- Mark your todo item/ticket done when the work is done (ticket_status with
  the OWNER's session id); the ORCHESTRATOR removes todo items — never you.
  If the same ticket call fails twice with the same error, STOP calling it:
  state the blocker in your final report; never retry a third time. On any
  error, re-emit corrected_call verbatim — it is the complete call.`
}

// ─── Per-tool execute handlers ─────────────────────────────────────────────
// Runtime checks remain as defense in depth: the schema rejects missing
// params at the harness layer when the harness validates; these envelopes
// cover every other path — and keep the contract greppable.

export async function executeAdd(args: any, context: any): Promise<{ content: string }> {
  const s = getStore()
  const corrected: Record<string, unknown> = {
    rollout_id: args.rollout_id ?? "<fill: your session id>",
    todo: args.todo ?? "<fill: one-line summary>",
  }
  if (args.md_content !== undefined) corrected.md_content = args.md_content
  const jtd = jtdValidateAdd(args)
  if (jtd.length) return jtdFail("ADD", jtd, corrected)
  // JTD passes; empty strings are still missing semantically.
  if (!args.todo) return fail("E_ADD_MISSING_TODO", "ticket_add requires 'todo' (the one-line summary)", corrected)
  if (!args.rollout_id) return fail("E_ADD_MISSING_ROLLOUT_ID", "ticket_add requires 'rollout_id' (your session id)", corrected)
  try {
    const row = s.add({ todo: args.todo, rollout_id: args.rollout_id, md_content: args.md_content ?? null })
    return ok({ rollout_id: row.rollout_id, id: row.id, ticket: row })
  } catch (e) {
    return fail("E_ADD_FAILED", (e as Error).message, corrected)
  }
}

export async function executeGet(args: any, context: any): Promise<{ content: string }> {
  const s = getStore()
  const corrected = { id: args.id ?? "<fill: ticket number>" }
  const jtd = jtdValidateGet(args)
  if (jtd.length) return jtdFail("GET", jtd, corrected)
  const row = s.get(args.id)
  if (!row) return fail("E_NO_TICKET", `no ticket with number ${args.id}`, corrected)
  const comments = s.getComments(args.id)
  const rendered = comments.length
    ? `${JSON.stringify(row, null, 2)}\n\n--- comments (chronological) ---\n${comments
        .map((c) => `[${c.created_at}] ${c.content}`)
        .join("\n")}`
    : JSON.stringify(row, null, 2)
  return { content: rendered }
}

export async function executeList(args: any, context: any): Promise<{ content: string }> {
  const s = getStore()
  const corrected = { rollout_id: args.rollout_id ?? "<fill: the session id to query>", all: true }
  const jtd = jtdValidateList(args)
  if (jtd.length) return jtdFail("LIST", jtd, corrected)
  if (!args.rollout_id && !args.all)
    return fail(
      "E_LIST_MISSING_ROLLOUT_ID",
      "ticket_list requires 'rollout_id' (the session id to query) — or all=true for every session's tickets",
      corrected,
    )
  try {
    return ok(s.list({ status: args.status, rollout_id: args.rollout_id, all: args.all }))
  } catch (e) {
    return fail("E_LIST_FAILED", (e as Error).message, { rollout_id: args.rollout_id ?? "<session id>", all: args.all })
  }
}

export async function executeComment(args: any, context: any): Promise<{ content: string }> {
  const s = getStore()
  const corrected = {
    id: args.id ?? "<fill: ticket number>",
    content: args.content ?? "<fill: done / not done / blocked>",
  }
  const jtd = jtdValidateComment(args)
  if (jtd.length) return jtdFail("COMMENT", jtd, corrected)
  if (!args.content) return fail("E_COMMENT_MISSING_CONTENT", "ticket_comment requires 'content' — a short go/no-go note", corrected)
  if (String(args.content).length > 1000)
    return fail(
      "E_COMMENT_TOO_LONG",
      "a comment is a short go/no-go note — done / not done / blocked (1000 chars max). Long reports never go on the ticket: put the detail in your final response (or a gist)",
      { id: args.id, content: "<fill: short note>" },
    )
  try {
    const c = s.appendComment(args.id, args.content, context?.sessionID ?? null)
    return ok(c)
  } catch (e) {
    return fail("E_NO_TICKET", (e as Error).message.replace("appendComment: ", "ticket_comment: "), corrected)
  }
}

export async function executeStatus(args: any, context: any): Promise<{ content: string }> {
  const s = getStore()
  const callerSession = context?.sessionID
  const jtd = jtdValidateStatus(args)
  if (jtd.length) {
    // corrected_call self-heals: when the ticket is known, the REAL owner
    // session id is filled in, and the status is a LEGAL value — so a
    // verbatim re-emit succeeds (issue #18 acceptance).
    const row = typeof args?.id === "number" ? s.get(args.id) : undefined
    const statusLegal = typeof args?.status === "string" && STATUS_ENUM.includes(args.status)
    const corrected = row
      ? { id: row.id, rollout_id: row.rollout_id, status: statusLegal ? args.status : "pending" }
      : {
          id: args?.id ?? "<fill: ticket number>",
          rollout_id: args?.rollout_id ?? "<the ticket's owner session id>",
          status: statusLegal ? args.status : "pending",
        }
    return jtdFail("STATUS", jtd, corrected)
  }
  const row = s.get(args.id)
  if (!row) return fail("E_NO_TICKET", `no ticket with number ${args.id}`, { id: args.id })
  const corrected = { id: row.id, rollout_id: row.rollout_id, status: args.status }
  // JTD passed, but an empty-string rollout_id is still missing semantically.
  if (!args.rollout_id)
    return fail("E_STATUS_MISSING_ROLLOUT_ID", `ticket_status requires 'rollout_id' — this ticket's owner session id is "${row.rollout_id}"`, corrected)
  try {
    const updated = s.setStatus(args.id, { rollout_id: args.rollout_id, status: args.status, last_actor: callerSession ?? null })
    if (!updated) return fail("E_NO_TICKET", `no ticket with number ${args.id}`, corrected)
    return ok(updated)
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes("status must be one of"))
      return fail("E_STATUS_BAD_STATUS", msg, { ...corrected, status: "pending" })
    if (msg.includes("refused"))
      return fail("E_STATUS_REFUSED", msg + ` — the owner session id is "${row.rollout_id}"`, corrected)
    return fail("E_STATUS_FAILED", msg, corrected)
  }
}

export async function executeRules(args: any = {}): Promise<{ content: string }> {
  const jtd = jtdValidateNone(args)
  if (jtd.length) return jtdFail("RULES", jtd, {})
  return { content: rulesText() }
}

export async function executeHelp(args: any = {}): Promise<{ content: string }> {
  const jtd = jtdValidateNone(args)
  if (jtd.length) return jtdFail("HELP", jtd, {})
  return { content: helpText() }
}
