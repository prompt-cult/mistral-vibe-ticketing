# mistral-vibe-ticketing — design

Port of [opencode-ticketing](https://github.com/prompt-cult/opencode-ticketing) (v2.2.1) to a
Mistral Vibe plugin (Agent Plugins 1.0). Logic unchanged; only the registration layer differs
(opencode `tools.add` plugin → stdio MCP server).

## Goal

Same seven-tool surface, same contract (immutable ticket body, append-only comments, status the
only mutation, rollout_id = session id, corrected_call error envelope, ticket_rules as the
delegee rule source of truth), running as a native-feeling toolset inside Vibe.

## Harness facts (mistral-vibe v3.1.0, source-verified)

- Plugins live at `<project>/.vibe/plugins/<name>/` (trusted folder) or `~/.vibe/plugins/<name>/`.
- Manifest: `plugin.json`, `$schema` exactly `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`.
- `ai.mistral.vibe` extension in the manifest enables: `toolNamespace`, `toolOverrides`
  (rename/exposure), hooks, knowledge, agents, libraries, connectors.
- `mcp.json` stdio servers: `"command": "bun", "args": ["run", "${PLUGIN_ROOT}/server/index.ts"]`.
  `PLUGIN_ROOT` (session's read-only install copy) and `PLUGIN_DATA` (session's writable data dir,
  shared with hooks) are injected automatically. bun:sqlite is fine — no rewrite to node:sqlite.
- Vibe refuses OpenCode executable modules (only skills + declarative MCP servers survive the
  .opencode adapter), hence the MCP wrap.
- Cannot compile another Andon/todowrite mirror via reserved namespaces; reserved: `file_system`,
  `self`, `process`, `skill`, `subagent`, `vibe`.

## Layout

```
mistral-vibe-ticketing/
  plugin.json            # manifest + ai.mistral.vibe extension
  mcp.json               # stdio server: bun + server/index.ts
  skills/
    ticketing/
      SKILL.md           # port of skills/opencode-ticketing/SKILL.md
  server/
    index.ts             # MCP stdio entry — JSON-RPC over stdin/stdout
    ticket-store.ts      # inlined from v2.2.1/ticket.ts store section (bun:sqlite)
    tools.ts             # the 7 tools: schemas, JTD-derived validation, envelopes
    todo-protocol.ts     # shipped unchanged from v2.2.1
  ai.mistral.vibe/
    hooks.toml           # post_tool hook mirroring vibe todo → ticket status
  DESIGN.md
  README.md              # install: ~/.vibe/plugins/ticketing/ or .vibe/plugins/ticketing/
```

## Differences from the opencode plugin

| Concern | opencode v2.2.1 | Vibe port | Notes |
|---|---|---|---|
| Tool registration | `tools.add({ execute })` plugin TS | MCP `tools/call` | Vibe rejects executable modules |
| DB home | `~/.config/opencode/opencode_ticketing` | `PLUGIN_DATA` (or `TICKET_DB_HOME`) | cross-session, cross-repo preserved |
| Schema validation | jtd-codegen validators (JS) | same validators, generated once into `server/` | or hand-ported JSON Schema — identical strictness |
| comment cap | 1000 chars | 1000 | unchanged |
| deadline | v2.2.5 harness must stage entry file | none (bundled in plugin tree) | ^ |
| todo link | todowrite hook sets ticket status | both: SKILL.md numbering rule (`N: name`) + post_tool hook on the todo tool calling a CLI util in server/ | post_tool hooks fire in plugin root; hook script reads hook JSON on stdin, calls a server/ CLI subcommand against the same DB — see Invariants |
| session identity | opencode `emit` context, `ses_…` id | hook JSON carries session folder/id; tools use it for rollout_id | the MCP env on Vibe doesn't provide `ses_…` ids — see rollout_id below |

The SKILL.md numbering rule ("`N: <name>`" in todo) is the primary bridge; the post_tool hook is
secondary (fail-open). This is deliberate — we can't gate on Vibe internals differing across
versions, and the opencode plugin already made SKILL.md + tools the source of truth.

### toolOverrides

Extension sets `toolNamespace: "ticketing"` — tools surface as `ticketing.ticket_add`,
`ticketing.ticket_rules`, etc. All seven `direct_and_programmatic` (default).

## Runtime details

- The MCP server is on-demand: Vibe spawns it `stdio` per session; writes to `PLUGIN_DATA`.
- Types end up accessible at runtime by harness agents; no further plugin work needed.

## Task order

```
1. Scaffold plugin tree + manifest (plugin.json, mcp.json, ai.mistral.vibe dir)
2. Port ticket-store.ts + todo-protocol.ts from v2.2.1 (bun:sqlite kept)
3. Build stdio MCP server — 7 tools, schemas, corrected_call envelopes, session id from env
4. Port SKILL.md → skills/ticketing/SKILL.md (docs/mechanics updated to Vibe tool names)
5. Hooks: ai.mistral-vibe/hooks.toml — post_tool on vibe todo → server/ CLI flush
6. README + install (project scope · PATH check · /reload)
7. Test: reference ticket.test.ts ported/run with bun test, flip each side to fail
8. Install at .vibe/plugins/ticketing/ in this repo; verify (add/get/list/comment/status/rules/help); validation errors, comment >1000, wrong status, missing params; todo-mirror flush test
9. Cleanup .tmp/ per instructions, commit
```

## Invariants — what must NOT change

- Ticket is immutable; status is the only field that changes; nothing is ever deleted.
- Comments: one at a time, short go/no-go notes, ≤1000 chars.
- `rollout_id` semantics: the session id, one id, no other.
- Error contract: `{ code: "E_…", message, corrected_call }` — failing call passes corrected args.
- `ticket_rules` is the single source of delegee rules; subagent's first two calls are
  `ticket_get`, `ticket_rules`.
- No `action` string — one tool per action, misuse unrepresentable at the schema layer.
- Session id isørg harness-reported, never fabricated by a caller (see MRs).
- Global sequencer = the DB's autoincrement id; the todo list only carries the number "N:".

## Open questions (user to decide)

1. rollout_id: Vibe does not inject a `ses_…` id into stdio server env. Options:
   (a) SKILL.md and hook pass the session id explicitly per call; (b) tools require a
   caller-supplied id and the hook stamps it; (c) drop to directory-path-derived ids.
2. Server mode: keep server as TS run via `bun run`, or pre-compile to a standalone snapshot
   (`bun build`) to avoid a bun runtime dependency on the target machine?
3. Scope: project-scope `.vibe/plugins/` here for testing, then `~/.vibe/plugins/` for global?
