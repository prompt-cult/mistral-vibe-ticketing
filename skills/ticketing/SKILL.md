---
name: ticketing
description: Use for multi-step or long-lived engineering work — create a ticket to get a ticket number, add a numbered todo item, delegate tickets (with their numbers) to subagents. Tickets survive across sessions and repos.
---

# Ticketing (mistral-vibe port of opencode-ticketing)

Tools surface as `ticketing.ticket_add`, `ticketing.ticket_get`,
`ticketing.ticket_list`, `ticketing.ticket_comment`, `ticketing.ticket_status`,
`ticketing.ticket_rules`, `ticketing.ticket_help`. Call `ticketing.ticket_help`
first if the contract is not fresh: **a ticket is an immutable record with an
append-only comment stream; status is the only field that ever changes.** The
todo list is ephemeral ordering. The database is ONE SQLite file outside every
repo (`~/.config/mistral-vibe/mistral-vibe-ticketing/ticket.db`), shared by all
TUIs on hundreds of projects and worktrees; the autoincrement id is the only
global ticket number.

## The flow: create, comment, change status

1. New task → `ticket_add rollout_id=<your session id> todo="one-line summary"
   md_content=<the full spec>` → returns the permanent ticket number **N**.
   The body is written ONCE — there is no rewrite action. The database copy is
   the record; keep any plan file in the repo's gitignored
   `.tmp/tickets/NNN_slug.md` scratch only while drafting.
2. todo — append item **`N: <descriptive name>`** at the END of the list.
   Front-jump only when the user says "do it next" or gives an explicit order.
   Closing the item closes ticket N automatically (the mirror hook).
3. Everything after creation is a comment — a SHORT go/no-go note: done /
   not done / blocked, 1000 chars max: `ticket_comment id=N content="..."`.
   Long reports NEVER go on the ticket — detail lives in the final response.
4. Status is the only mutation: `ticket_status id=N
   rollout_id=<OWNER session id> status=<pending|in_progress|completed|
   cancelled|superseded>`, or the todo mirror does it for you. To supersede:
   set the status and name the replacement ticket in a comment. Nothing is
   ever deleted.

## Delegation — the stack/burndown cycle

1. Orchestrator creates the ticket (body self-contained before launch), pops
   it, hands the subagent ONLY the ticket number — never a path.
2. Subagent's first two calls are READS: `ticket_get id=N` (body + comments
   are its full instructions), then `ticket_rules` — obey every rule it
   returns. NO write to the ticket is a prerequisite for starting work. It
   never edits the ticket. It returns a report — it does NOT commit, push,
   open PRs, or watch CI.
3. Orchestrator, on return: marks the todo done + ticket complete (burndown,
   never delete), then re-runs the gate itself.
   - **Green** → orchestrator commits (and may push).
   - **Red** → orchestrator raises a follow-on todo + ticket, pushes it onto
     the stack, works it next. Iterate until green.
4. No CI monitoring until all tickets are done.

## rollout_id and session ids on Vibe

Vibe provides no `ses_…` id in stdio server env. The plugin derives a stable
per-session id: the hook stamp is the session directory name (the `cwd` field
of the hook's stdin JSON), exposed to the tools as the caller's session id via
`TICKET_SESSION_ID`. If unset, make rollout_id an explicit, human-readable id
you keep for the whole session (e.g. `vibe-<date>-<topic>`), and NAME it to
delegatees — it is what they pass on `ticket_status` and `ticket_list`.
Adopt another session's work with `ticket_list rollout_id=<that id>`.

## Errors

Every failure returns `{code, message, corrected_call}`. corrected_call is the
COMPLETE call — received values kept, the REAL owner session id filled
wherever the ticket is known. Re-emit it verbatim (fill any `<fill: …>`
placeholder) and the call succeeds. Never retry a failing call more than
once.
