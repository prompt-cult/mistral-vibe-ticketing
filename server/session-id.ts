// session-id.ts — session-id probe tools (issue #1): two steps, stateless.
// Step 1 session_id_write_marker mints (or accepts) a uuid + ISO ts and
// returns the exact bash line the caller must echo so the marker lands in
// its own session journal. Step 2 session_id_find_marker greps the Vibe
// session logs for that uuid and reports which rollout it belongs to.
// Read-only on the logs tree; reads nothing but logs; writes nothing.
// Every failure returns the {code, message, corrected_call} envelope, the
// same contract as ticket.ts.
import { readdir, stat, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fail, parseEnvelope } from "./ticket"

export { parseEnvelope }

function ok(payload: unknown): { content: string } {
  return { content: JSON.stringify(payload, null, 2) }
}

const HELP_HINT_SUFFIX = " — recover with one call: ticket_help"

// ─── Vibe home resolution ───────────────────────────────────────────────────
// The logs root is $VIBE_HOME by default (~/.vibe). TICKET_TEST_VIBE_HOME
// overrides it for tests so bun:test never touches the real logs tree.

export function vibeHome(): string {
  return process.env.TICKET_TEST_VIBE_HOME ?? process.env.VIBE_HOME ?? join(homedir(), ".vibe")
}

function sessionRoot(): string {
  return join(vibeHome(), "logs", "session")
}

const MARKER_TAG = "VIBE-ROLLOUT-MARKER"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const LEGACY_SUFFIX = "messages.jsonl_do_not_use_legacy"

// ─── RFC 8927 legal parameter sets ──────────────────────────────────────────

export const WRITE_MARKER_JTD = {
  optionalProperties: { uuid: { type: "string" }, ts: { type: "string" } },
}

export const FIND_MARKER_JTD = {
  properties: { uuid: { type: "string" } },
  optionalProperties: { ts: { type: "string" } },
}

export function jtdValidateWriteMarker(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/properties" })
    return e
  }
  for (const k of ["uuid", "ts"]) {
    if (k in instance && instance[k] !== undefined) {
      if (typeof instance[k] !== "string") e.push({ instancePath: `/${k}`, schemaPath: `/optionalProperties/${k}/type` })
    }
  }
  for (const k in instance) {
    if (k !== "uuid" && k !== "ts") e.push({ instancePath: `/${k}`, schemaPath: "" })
  }
  return e
}

export function jtdValidateFindMarker(instance: any) {
  const e: any[] = []
  if (instance === null || typeof instance !== "object" || Array.isArray(instance)) {
    e.push({ instancePath: "", schemaPath: "/properties" })
    return e
  }
  if (!("uuid" in instance) || instance["uuid"] === undefined) e.push({ instancePath: "", schemaPath: "/properties/uuid" })
  else {
    if (typeof instance["uuid"] !== "string") e.push({ instancePath: "/uuid", schemaPath: "/properties/uuid/type" })
  }
  if ("ts" in instance && instance["ts"] !== undefined) {
    if (typeof instance["ts"] !== "string") e.push({ instancePath: "/ts", schemaPath: "/optionalProperties/ts/type" })
  }
  for (const k in instance) {
    if (k !== "uuid" && k !== "ts") e.push({ instancePath: `/${k}`, schemaPath: "" })
  }
  return e
}

// Same stable envelope-code mapping as ticket.ts's jtdFail, scoped to these
// tools' names: missing → E_<TOOL>_MISSING_<PARAM>, bad type → E_<TOOL>_BAD_<PARAM>,
// junk key → E_<TOOL>_EXTRA_PROPERTY, non-object → E_<TOOL>_NOT_AN_OBJECT.
function jtdFail(tool: string, errors: any[], corrected: Record<string, unknown>): { content: string } {
  const first = errors[0]
  const lower = tool.toLowerCase()
  const missing = /^\/properties\/(\w+)$/.exec(first.schemaPath || "")
  if (missing) return fail(`E_${tool}_MISSING_${missing[1].toUpperCase()}`, `session_id_${lower} requires '${missing[1]}'`, corrected)
  const bad = /^\/(properties|optionalProperties)\/(\w+)\/type$/.exec(first.schemaPath || "")
  if (bad) return fail(`E_${tool}_BAD_${bad[2].toUpperCase()}`, `session_id_${lower}: '${bad[2]}' has the wrong type`, corrected)
  const extra = /^\/(\w+)$/.exec(first.instancePath || "")
  if ((first.schemaPath || "") === "" && extra)
    return fail(
      `E_${tool}_EXTRA_PROPERTY`,
      `'${extra[1]}' is not a legal parameter of session_id_${lower} — the legal set is exactly its declared params`,
      corrected,
    )
  return fail(`E_${tool}_NOT_AN_OBJECT`, `session_id_${lower} takes an object with exactly its declared params`, corrected)
}

// ─── Per-tool harness schemas + descriptions ───────────────────────────────

export const WRITE_MARKER_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    uuid: { type: "string", description: "optional: a uuid you minted yourself (otherwise one is minted for you)" },
    ts: { type: "string", description: "optional: ISO 8601 timestamp for the marker (otherwise now, UTC)" },
  },
}

export const FIND_MARKER_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    uuid: { type: "string", description: "the uuid from session_id_write_marker (or your own)" },
    ts: { type: "string", description: "optional: the ISO timestamp from step 1, echoed back" },
  },
  required: ["uuid"],
}

export const WRITE_MARKER_DESC = `Mint (or accept) a uuid + ISO ts and return the exact bash line to run
next — echo "${MARKER_TAG} <uuid> @<ts>" — so the marker is flushed into
this session's own journal. Step 1 of the two-call session-id probe; the
server holds no state, so pass uuid and ts explicitly into
session_id_find_marker next.`

export const FIND_MARKER_DESC = `Find the session whose Vibe journal contains the marker uuid from
session_id_write_marker. Search order: session/unified/<dir>/journal/*.jsonl
+ meta.json, recent-mtime-first, then the renamed legacy archives
messages.jsonl_do_not_use_legacy only. Read-only. Returns
{matched_path, session_dir, session_id, suggested_rollout_id}.`

// ─── Step 1: write_marker ───────────────────────────────────────────────────

export async function executeWriteMarker(args: any, context: any): Promise<{ content: string }> {
  const corrected: Record<string, unknown> = {}
  if (args.uuid !== undefined) corrected.uuid = args.uuid
  if (args.ts !== undefined) corrected.ts = args.ts
  const jtd = jtdValidateWriteMarker(args)
  if (jtd.length) return jtdFail("WRITE_MARKER", jtd, corrected)
  if (args.uuid !== undefined && !UUID_RE.test(args.uuid))
    return fail("E_WRITE_MARKER_BAD_UUID", "session_id_write_marker: 'uuid' must be a uuid", corrected)
  if (args.ts !== undefined && !ISO_TS_RE.test(args.ts))
    return fail("E_WRITE_MARKER_BAD_TS", "session_id_write_marker: 'ts' must be an ISO 8601 UTC timestamp", corrected)
  const uuid = args.uuid ?? crypto.randomUUID()
  const ts = args.ts ?? new Date().toISOString()
  return ok({
    uuid,
    ts,
    command_line: `echo "${MARKER_TAG} ${uuid} @${ts}"`,
    hint: "run that bash line now (e.g. with your run-bash tool), then call session_id_find_marker with this uuid and ts",
  })
}

// ─── Step 2: find_marker ────────────────────────────────────────────────────

// Newest-first list of candidate files under one session dir: the live
// journal chunks + meta.json; nothing else is read.
async function unifiedCandidates(sessionDir: string): Promise<{ path: string; mtime: number }[]> {
  const out: { path: string; mtime: number }[] = []
  try {
    const journalDir = join(sessionDir, "journal")
    if (!existsSync(journalDir)) return out
    for (const name of await readdir(journalDir)) {
      if (!name.endsWith(".jsonl")) continue
      const p = join(journalDir, name)
      try {
        out.push({ path: p, mtime: (await stat(p)).mtimeMs })
      } catch {}
    }
    const meta = join(sessionDir, "meta.json")
    if (existsSync(meta)) {
      try {
        out.push({ path: meta, mtime: (await stat(meta)).mtimeMs })
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.mtime - a.mtime)
}

// Legacy archives only under their renamed, explicit do-not-use name.
async function legacyCandidates(sessionRoot_: string): Promise<{ path: string; mtime: number }[]> {
  const out: { path: string; mtime: number }[] = []
  try {
    if (!existsSync(sessionRoot_)) return out
    for (const dir of await readdir(sessionRoot_)) {
      if (!dir.startsWith("session_")) continue
      const p = join(sessionRoot_, dir, LEGACY_SUFFIX)
      if (!existsSync(p)) continue
      try {
        out.push({ path: p, mtime: (await stat(p)).mtimeMs })
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.mtime - a.mtime)
}

// Whether a file's text contains the uuid.
async function fileHasUuid(path: string, uuid: string): Promise<boolean> {
  try {
    const text = await readFile(path, "utf8")
    return text.includes(uuid)
  } catch {
    return false
  }
}

// Parse the session id out of a matched session dir: meta.json id preferred,
// the journal session-dir name as the fallback.
async function parseSessionId(sessionDir: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await readFile(join(sessionDir, "meta.json"), "utf8"))
    if (typeof meta?.id === "string" && meta.id) return meta.id
    if (typeof meta?.sessionId === "string" && meta.sessionId) return meta.sessionId
  } catch {}
  return null
}

export async function executeFindMarker(args: any, context: any): Promise<{ content: string }> {
  const corrected: Record<string, unknown> = {
    uuid: args.uuid ?? "<fill: the uuid from session_id_write_marker>",
  }
  if (args.ts !== undefined) corrected.ts = args.ts
  const jtd = jtdValidateFindMarker(args)
  if (jtd.length) return jtdFail("FIND_MARKER", jtd, corrected)
  if (!args.uuid)
    return fail("E_FIND_MARKER_MISSING_UUID", "session_id_find_marker requires 'uuid'", corrected)
  if (!UUID_RE.test(args.uuid))
    return fail("E_FIND_MARKER_BAD_UUID", "session_id_find_marker: 'uuid' must be a uuid", corrected)

  const root = sessionRoot()
  const unified = join(root, "unified")

  // Session dirs, newest-mtime-of-journal first.
  const dirs: { dir: string; newest: number }[] = []
  try {
    if (existsSync(unified)) {
      for (const dir of await readdir(unified)) {
        const sd = join(unified, dir)
        try {
          if (!(await stat(sd)).isDirectory()) continue
        } catch {
          continue
        }
        const cands = await unifiedCandidates(sd)
        if (cands.length) dirs.push({ dir: sd, newest: cands[0].mtime })
      }
    }
  } catch {}
  dirs.sort((a, b) => b.newest - a.newest)

  for (const { dir } of dirs) {
    for (const { path } of await unifiedCandidates(dir)) {
      if (!(await fileHasUuid(path, args.uuid))) continue
      const sessionId = (await parseSessionId(dir)) ?? dir.split("/").pop() ?? dir
      return ok({
        matched_path: path,
        session_dir: dir,
        session_id: sessionId,
        suggested_rollout_id: sessionId,
        ...(args.ts !== undefined ? { ts: args.ts } : {}),
      })
    }
  }

  // Legacy fallback: ONLY files named messages.jsonl_do_not_use_legacy.
  for (const { path } of await legacyCandidates(root)) {
    if (!(await fileHasUuid(path, args.uuid))) continue
    const dir = path.split("/").slice(0, -1).join("/")
    const sessionId = dir.split("/").pop() ?? dir
    return ok({
      matched_path: path,
      session_dir: dir,
      session_id: sessionId,
      suggested_rollout_id: sessionId,
      legacy: true,
      ...(args.ts !== undefined ? { ts: args.ts } : {}),
    })
  }

  return fail("E_FIND_MARKER_NO_MATCH", `no session journal under ${root} contains the marker uuid ${args.uuid} — run the echo command from session_id_write_marker first`, corrected)
}
