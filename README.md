# mistral-vibe-ticketing

Port of [opencode-ticketing](https://github.com/prompt-cult/opencode-ticketing)
(v2.2.1) to a Mistral Vibe plugin (Agent Plugins 1.0 + `ai.mistral.vibe`
extensions). Registration layer only — the contract is unchanged:

- A ticket is an IMMUTABLE record with an APPEND-ONLY comment stream; STATUS
  is the only field that ever changes. Nothing is ever deleted.
- `rollout_id` IS the session id — one id, no other.
- One tool per action; per-tool JTD schemas; every failure returns
  `{code, message, corrected_call}` (re-emit verbatim → success).
- The built-in todo list is hot ordering; the ticket store is cold storage.
  The todo mirror hook closes ticket `N` when todo item `N: …` closes.
- One SQLite DB outside every repo, shared by all TUIs on all projects and
  worktrees: `~/.config/mistral-vibe/mistral-vibe-ticketing/ticket.db`
  (override with `TICKET_DB_HOME`).

## Tools

`ticketing.ticket_add` / `ticket_get` / `ticket_list` / `ticket_comment` /
`ticket_status` / `ticket_rules` / `ticket_help`. Full contract:
`ticket_help`.

## Install (agent-friendly)

```sh
./install.sh          # global: ~/.vibe/plugins/ticketing/, then /reload
# or project scope (trusted folder):
mkdir -p .vibe/plugins && cp -R "$(pwd)" .vibe/plugins/ticketing && /reload
```

Requires `bun` on PATH (run `command -v bun` to prove it before install; the
imperative is "do not fetch modules at build time" — none are fetched).

## Test

```sh
TICKET_DB_HOME=$(mktemp -d .tmp/db-XXXX) bun test server/ticket.test.ts
```

16 tests: the split-tool contract, per-tool required schemas, the envelope on
every failure path, the verbatim-re-emit acceptance, the todowrite mirror.

## Layout

```
plugin.json               Agent Plugins 1.0 manifest + ai.mistral.vibe ext
mcp.json                  stdio server: bun run ${PLUGIN_ROOT}/server/index.ts
server/ticket.ts          tool surface: schemas, JTD validators, handlers, contract text
server/ticket-store.ts    TicketStore (bun:sqlite), TABLE ticket + ticket_comment
server/sync-hook.ts       todo mirror (post_tool hook, fail-open)
server/index.ts           MCP stdio JSON-RPC entry
server/ticket.test.ts     the contract tests
skills/ticketing/         SKILL.md — the flow + delegation doctrine
ai.mistral.vibe/hooks.toml  todo-mirror post_tool hook
```
