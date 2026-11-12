// session-id.test.ts — the session-id probe tools (issue #1): write_marker
// is a pure mint/echo of uuid+ts+command_line; find_marker greps the Vibe
// session logs, newest-mtime-first, unified layout first and the renamed
// legacy archives only. Exercised with bun:test against a fixture tree
// under a temp TICKET_TEST_VIBE_HOME — no network, no real ~/.vibe.
import { test, expect, beforeAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import {
  executeWriteMarker,
  executeFindMarker,
  parseEnvelope,
  jtdValidateWriteMarker,
  jtdValidateFindMarker,
  WRITE_MARKER_JTD,
  FIND_MARKER_JTD,
  WRITE_MARKER_INPUT,
  FIND_MARKER_INPUT,
} from "./session-id"

let home = ""

const UUID_A = "aaaaaaaa-1111-2222-3333-444444444444"
const UUID_B = "bbbbbbbb-1111-2222-3333-444444444444"
const UUID_C = "cccccccc-1111-2222-3333-444444444444"
const TS = "2026-11-12T15:06:48.019Z"

beforeAll(() => {
  home = mkdtempSync(join(".tmp", "session-id-test-"))
  process.env.TICKET_TEST_VIBE_HOME = home
  // Fixture: two unified sessions + one legacy archive.
  // Session A matches UUID_A in its journal and via meta.json.
  const a = join(home, "logs", "session", "unified", "sessA-dir", "journal")
  mkdirSync(a, { recursive: true })
  writeFileSync(
    join(a, "0000000000000317.jsonl"),
    JSON.stringify({ type: "core_input", value: `echo "VIBE-ROLLOUT-MARKER ${UUID_A} @${TS}"` }) + "\n",
  )
  writeFileSync(join(home, "logs", "session", "unified", "sessA-dir", "meta.json"), JSON.stringify({ id: "sessA-id" }))
  // Session B: newer mtime, matches UUID_B; no meta.json id → dir-name fallback.
  const b = join(home, "logs", "session", "unified", "sessB-dir", "journal")
  mkdirSync(b, { recursive: true })
  writeFileSync(
    join(b, "0000000000000400.jsonl"),
    JSON.stringify({ type: "core_input", value: `VIBE-ROLLOUT-MARKER ${UUID_B} @${TS}` }) + "\n",
  )
  writeFileSync(join(home, "logs", "session", "unified", "sessB-dir", "meta.json"), JSON.stringify({ other: true }))
  // Legacy archive, renamed in place per the finder's rule — matches UUID_C.
  const legacy = join(home, "logs", "session", "session_20260101-legacy")
  mkdirSync(legacy, { recursive: true })
  writeFileSync(
    join(legacy, "messages.jsonl_do_not_use_legacy"),
    JSON.stringify({ text: `VIBE-ROLLOUT-MARKER ${UUID_C} @${TS}` }) + "\n",
  )
  // A live messages.jsonl must NEVER be read as fallback.
  writeFileSync(join(legacy, "messages.jsonl"), `VIBE-ROLLOUT-MARKER ${UUID_C}\n`)
})

function envelope(content: string) {
  const e = parseEnvelope(content)
  expect(e).not.toBeNull()
  return e!
}

// ─── write_marker: pure mint, deterministic inputs ──────────────────────────

test("write_marker mints uuid + ts and returns the exact command line containing both", async () => {
  const r = JSON.parse((await executeWriteMarker({}, {})).content)
  expect(r.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  expect(r.command_line).toBe(`echo "VIBE-ROLLOUT-MARKER ${r.uuid} @${r.ts}"`)
  expect(typeof r.hint).toBe("string")
})

test("write_marker honours supplied uuid/ts and echoes them verbatim", async () => {
  const r = JSON.parse((await executeWriteMarker({ uuid: UUID_A, ts: TS }, {})).content)
  expect(r.uuid).toBe(UUID_A)
  expect(r.ts).toBe(TS)
  expect(r.command_line).toBe(`echo "VIBE-ROLLOUT-MARKER ${UUID_A} @${TS}"`)
})

// ─── schemas gate the probe tools like every other tool ──────────────────────

test("the probe validators return the envelope with corrected_call on bad input", async () => {
  expect(jtdValidateWriteMarker({ junk: 1 })).toEqual([{ instancePath: "/junk", schemaPath: "" }])
  expect(jtdValidateWriteMarker({ uuid: 5 })[0].schemaPath).toBe("/optionalProperties/uuid/type")
  expect(jtdValidateWriteMarker({})).toEqual([])
  expect(jtdValidateFindMarker({})).toEqual([{ instancePath: "", schemaPath: "/properties/uuid" }])
  expect(jtdValidateFindMarker({ uuid: 5 })[0].schemaPath).toBe("/properties/uuid/type")
  expect(jtdValidateFindMarker({ uuid: "u", junk: 1 })).toEqual([{ instancePath: "/junk", schemaPath: "" }])
  expect(jtdValidateFindMarker({ uuid: "u", ts: "t" })).toEqual([])
  // the JTD sets and the harness-facing JSON Schemas agree
  expect(Object.keys(FIND_MARKER_JTD.properties).sort()).toEqual(FIND_MARKER_INPUT.required.slice().sort())
  expect(Object.keys(WRITE_MARKER_JTD.optionalProperties!).sort()).toEqual(Object.keys(WRITE_MARKER_INPUT.properties).sort())
  expect(WRITE_MARKER_INPUT.additionalProperties).toBe(false)
  expect(FIND_MARKER_INPUT.additionalProperties).toBe(false)
})

test("find_marker returns structured envelopes: missing / bad type / bad uuid", async () => {
  const e1 = envelope((await executeFindMarker({}, {})).content)
  expect(e1.code).toBe("E_FIND_MARKER_MISSING_UUID")
  expect(e1.corrected_call.uuid).toContain("<fill:")
  const e2 = envelope((await executeFindMarker({ uuid: 7 }, {})).content)
  expect(e2.code).toBe("E_FIND_MARKER_BAD_UUID")
  const e3 = envelope((await executeFindMarker({ uuid: "not-a-uuid" }, {})).content)
  expect(e3.code).toBe("E_FIND_MARKER_BAD_UUID")
  const e4 = envelope((await executeFindMarker({ uuid: UUID_A, junk: 1 }, {})).content)
  expect(e4.code).toBe("E_FIND_MARKER_EXTRA_PROPERTY")
  expect(e4.corrected_call.uuid).toBe(UUID_A)
})

test("find_marker parses the session id — meta.json id preferred, dir name the fallback — and honours mtime recency", async () => {
  // Session B is the newest-mtime fixture; its meta.json lacks an id, so the
  // journal session-dir name is the fallback id.
  const b = JSON.parse((await executeFindMarker({ uuid: UUID_B, ts: TS }, {})).content)
  expect(b.session_id).toBe("sessB-dir")
  expect(b.session_dir).toContain("sessB-dir")
  expect(b.matched_path).toContain(join("journal", "0000000000000400.jsonl"))
  expect(b.suggested_rollout_id).toBe("sessB-dir")
  // Session A: meta.json id wins over the dir name.
  const a = JSON.parse((await executeFindMarker({ uuid: UUID_A }, {})).content)
  expect(a.session_id).toBe("sessA-id")
  expect(a.matched_path).toContain("sessA-dir")
})

test("find_marker prefers the newer mtime: a uuid present in two sessions resolves to the newer one", async () => {
  // Put UUID_B into session A's (older) journal too, then bump clocks so
  // the B-side record is definitively newer, bumping A after B.
  const aJournal = join(home, "logs", "session", "unified", "sessA-dir", "journal", "0000000000000318.jsonl")
  writeFileSync(aJournal, JSON.stringify({ value: UUID_B }) + "\n")
  // Pin the clocks: B's chunk strictly newer than anything in A, so B wins…
  // Pin the clocks: every file in A dates from 2019/2020 (the past)…
  const midTime = new Date(Date.UTC(2020, 0, 2))
  for (const f of [aJournal, join(home, "logs", "session", "unified", "sessA-dir", "meta.json"), join(home, "logs", "session", "unified", "sessA-dir", "journal", "0000000000000317.jsonl")])
    utimesSync(f, midTime, midTime)
  const bChunk = join(home, "logs", "session", "unified", "sessB-dir", "journal", "0000000000000400.jsonl")
  // Pinned epochs, a full year apart: two utimes a millisecond apart can
  // tie on a coarse filesystem clock and a tie falls back to dir order.
  const year2021 = new Date(Date.UTC(2021, 5, 15))
  const year2022 = new Date(Date.UTC(2022, 5, 15))
  // …while B's chunk is pinned in 2021, so B is the newest candidate.
  utimesSync(bChunk, year2021, year2021)
  const b = JSON.parse((await executeFindMarker({ uuid: UUID_B }, {})).content)
  expect(b.session_dir).toContain("sessB-dir")
  // …until A's chunk is pinned later still (2022): recency decides.
  utimesSync(aJournal, year2022, year2022)
  const a = JSON.parse((await executeFindMarker({ uuid: UUID_B }, {})).content)
  expect(a.session_dir).toContain("sessA-dir")
})

test("find_marker falls back ONLY to the renamed *_do_not_use_legacy archives, never a live messages.jsonl", async () => {
  // UUID_C is in BOTH session_20260101-legacy/messages.jsonl and the renamed
  // messages.jsonl_do_not_use_legacy. The live (non-renamed) file must never
  // be read as fallback; the renamed archive answers with legacy: true.
  const r = JSON.parse((await executeFindMarker({ uuid: UUID_C }, {})).content)
  expect(r.legacy).toBe(true)
  expect(r.matched_path.endsWith("messages.jsonl_do_not_use_legacy")).toBe(true)
  expect(r.session_id).toBe("session_20260101-legacy")
})

test("find_marker returns the no-match envelope for an unknown uuid", async () => {
  const e = envelope((await executeFindMarker({ uuid: "dddddddd-1111-2222-3333-444444444444" }, {})).content)
  expect(e.code).toBe("E_FIND_MARKER_NO_MATCH")
  expect(e.message).toContain("no session journal")
})
