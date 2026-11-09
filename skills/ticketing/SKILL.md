---
name: ticketing
description: Use for multi-step or long-lived engineering work — create a ticket to get a ticket number, add a numbered todo item, delegate tickets (with their numbers) to subagents. Tickets survive across sessions and repos.
---

# Ticketing (mistral-vibe port of opencode-ticketing)

**A ticket is an immutable record with an append-only comment stream; status is
the only field that ever changes.** The todo list is ephemeral ordering. The
database is ONE SQLite file outside every repo
(`~/.config/mistral-vibe/mistral-vibe-ticketing/ticket.db`), shared by all
TUIs on hundreds of projects and worktrees; the autoincrement id is the only
global ticket number.

## How to reach the tools (READ THIS FIRST)

The tools live on the plugin's MCP stdio server (`server/index.ts`, started by
Vibe from `mcp.json`), NOT in the built-in toolset. They are **normal tool
functions**, called the same way as `file_system` or any connector:

1. **Discovery**: call `search_tool_functions` (best_match) with a query such
   as `ticket_add ticket help`. You should see `mcp_ticketing.ticket_add`,
   `mcp_ticketing.ticket_get`, `mcp_ticketing.ticket_list`, `mcp_ticketing.ticket_comment`,
   `mcp_ticketing.ticket_status`, `mcp_ticketing.ticket_rules`, `mcp_ticketing.ticket_help`.
   Then `search_tool_functions` (details) on the exact name before first use.
2. **Call**: through `run_typescript`, as `await
   tools.mcp_ticketing.ticket_add({ ... })` — tools are grouped under
   `tools.<group>.<function>`, and this plugin's group is `mcp_ticketing` (server name prefixes the group).
   Args are plain objects matching each tool's schema.
3. **If the tools are NOT in the namespace** (freshly installed plugin): the
   server only mounts at session start. Tell the user to run `/reload` or open
   a new session, then retry discovery. Do NOT silently skip ticketing — say
   so and stop.

`mcp_ticketing.ticket_help({})` prints the whole contract (tools, required params,
statuses, delegation, error envelope). `mcp_ticketing.ticket_rules({})` is the
delegatee banner. When lost, call help first.

## Args cheat sheet

```
mcp_ticketing.ticket_add({ rollout_id, todo, md_content })        // → returns N
mcp_ticketing.ticket_get({ id: N })                               // row + comments
mcp_ticketing.ticket_list({ rollout_id })   or  ({ all: true })    // status: optional filter
mcp_ticketing.ticket_comment({ id: N, content })                  // ≤1000 chars, one at a time
mcp_ticketing.ticket_status({ id: N, rollout_id: OWNER, status }) // the ONLY mutation
mcp_ticketing.ticket_rules({})  mcp_ticketing.ticket_help({})
```

Statuses: pending | in_progress | completed | cancelled | superseded. Errors
return `{code, message, corrected_call}` — re-emit `corrected_call` verbatim
(fill any `<fill: …>`) and the call succeeds.

## The flow: create, comment, change status

1. New task → `ticket_add rollout_id=<your session id> todo="one-line summary"
   md_content=<the full spec>` → returns the permanent ticket number **N**.
   The body is written ONCE — there is no rewrite action. The database copy is
   the record; keep any plan file in the repo's gitignored
   `.tmp/tickets/NNN_slug.md` scratch only while drafting.
2. todo — append item **`N: <descriptive name>`** at the END of the list.
   Front-jump only when the user says "do it next" or gives an explicit order.
   Closing the item closes ticket N automatically (the plugin's post_tool
   mirror hook, fail-open) — but ONLY if your hand-picked rollout_id
   EXACTLY equals the hook-reported session id; the mirror's owner check
   (`syncStatuses`) silently skips on mismatch (fail-open). Keep your
   rollout_id identical to the session id Vibe passes the hook.
3. Everything after creation is a comment — a SHORT go/no-go note: done /
   not done / blocked, 1000 chars max. Long reports NEVER go on the ticket —
   detail lives in the final response.
4. Status is the only mutation: `ticket_status` with the OWNER's rollout_id,
   or the todo mirror does it for you. To supersede: set the status and name
   the replacement ticket in a comment. Nothing is ever deleted.

## rollout_id on Vibe

Vibe exposes no `ses_…` id to a stdio server. Pick one explicit, readable id
per session (e.g. `vibe-<date>-<topic>`), use it on every `ticket_add` and
`ticket_list`, and NAME it to delegatees — it is what they pass on
`ticket_status` (the OWNER's id) and `ticket_list`. Adopt another session's
work with `ticket_list({ rollout_id: "<that id>" })`.

## Never

- Do not read the SQLite file directly — the tools are the API.
- Do not rewrite or delete a ticket; supersede instead.
- Do not put long reports in comments.
- Do not retry a failing call more than once — re-emit `corrected_call`.

## Delegation — the stack/burndown cycle

1. Orchestrator creates the ticket (body self-contained before launch),
   pops it, hands the subagent ONLY the ticket number — never a path.
2. Subagent's first two calls are READS: `ticket_get id=N` (body +
   comments are its full instructions), then `ticket_rules` — obey
   every rule it returns. NO write to the ticket is a prerequisite for
   starting work: read, then work; comments are reports, never setup. It
   never edits the ticket. It returns a report — it does NOT commit,
   branch, push, open PRs, watch/poll CI.
3. Orchestrator, on return: marks the todo done + ticket complete
   (burndown, never delete), then re-runs the gate itself.
   - **Green** → orchestrator commits (and may push).
   - **Red** → orchestrator raises a follow-on todo + ticket, pushes it
     onto the stack, works it next. Iterate until green.
4. No CI monitoring until all tickets are done. AppVeyor orphans ignored.

**Boilerplate reduction.** Every subagent prompt should NOT re-state the
standing rules (no commit/push, no rm/reset/stash, tee clobber files,
bare-env macOS proof, etc.). Instead, the subagent's first actions are to
call `ticket_get id=N` and **`ticket_rules`** and obey the returned
rules. The tool is the single source of truth for delegee rules.

## Rules

- rollout_id IS the session id — one id, no other. On Vibe it is a
  hand-picked per-session id (see "rollout_id on Vibe" above), not `ses_…`.
  An agent MUST
  know its own session id: `add` and `list` take it by default. A delegator
  handing work to a delegatee NAMES the session id the delegatee must use
  (on `ticket_status` and `ticket_list`). To adopt another session's tickets:
  `list rollout_id=<that session id>`. Access is by ticket number everywhere
  else (`ticket_get id=N`, `ticket_comment id=N`). Mutations outside the owner's
  namespace are refused and the error names the owner.
- `list` requires the session id to query (`list rollout_id=<session id>
  [status=…]`); `all=true` lists every session's. An agent must know which
  session it is querying.
- Comments are short go/no-go notes (done / not done / blocked, 1000 chars
  max) — never essays. Long reports live in the agent's final response
  (or a gist), never on the ticket. Any session may append (the author is
  the calling session, stamped automatically); only the owner may change
  status.
- The body (`md_content`) is written once at `add`; it is never rewritten.
  Comments are the record after that — like a Jira issue: description is
  the spec, comment stream is the history.
- Recovery (crashed session): `ticket_list rollout_id=<your session id>`,
  rebuild the todo list from your pending/in_progress rows (or `all=true`).
- Never read the sqlite file directly — use the `ticket` tools.
- Errors are structured: every failure returns
  `{code, message, corrected_call}` — re-emit `corrected_call` verbatim
  (fill any `<fill: …>` placeholder) and the call succeeds. The legal
  parameter set of each tool is defined by an RFC 8927 (JSON Type
  Definition) schema and validated before the call runs: unknown
  parameters, wrong types and illegal values are rejected outright.

## Setup (once per environment, with the user's permission)

The `ticketing` tools come from this plugin's MCP stdio server
(`server/index.ts`). Install per the README (`./install.sh`, then
`/reload`), then confirm the `ticketing` tools exist and the todo-mirror
post_tool hook (`ai.mistral.vibe/hooks.toml`, `match = "todo"`) is loaded.
