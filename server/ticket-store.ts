import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export const STAMP: string = Date.now().toString(36)

const STATUS = ["pending", "in_progress", "completed", "cancelled", "superseded"] as const
export type TicketStatus = (typeof STATUS)[number]
export const STATUSES: ReadonlySet<string> = new Set<string>(STATUS)

export interface TicketRow {
  id: number
  created_at: string
  updated_at: string
  todo: string
  status: TicketStatus
  rollout_id: string
  last_actor: string | null
  md_content: string | null
}

export interface TicketComment {
  id: number
  ticket_id: number
  created_at: string
  content: string
  author_rollout_id: string | null
}

export interface AddInput {
  rollout_id: string
  todo: string
  md_content?: string
}

export interface SetStatusInput {
  rollout_id: string
  status: TicketStatus
  last_actor?: string | null
}

export interface ListFilter {
  rollout_id?: string
  status?: TicketStatus
  all?: boolean
}

export function ticketDbPath(): string {
  return join(
    process.env.TICKET_DB_HOME ?? join(homedir(), ".config", "mistral-vibe", "mistral-vibe-ticketing"),
    "ticket.db",
  )
}

export class TicketStore {
  private db: Database

  constructor(dbPath: string = ticketDbPath()) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ticket (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        todo TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        rollout_id TEXT NOT NULL,
        last_actor TEXT,
        md_content TEXT
      );
      CREATE TABLE IF NOT EXISTS ticket_comment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        content TEXT NOT NULL CHECK (length(content) <= 1000),
        author_rollout_id TEXT,
        FOREIGN KEY (ticket_id) REFERENCES ticket(id)
      );
    `)
  }

  private now(): string {
    return new Date().toISOString()
  }

  private assertStatus(status?: string) {
    if (status !== undefined && !STATUSES.has(status))
      throw new Error(`status must be one of ${[...STATUSES].join("|")}, got "${status}"`)
  }

  private assertOwner(row: TicketRow, rolloutId: string, action: string) {
    if (row.rollout_id !== rolloutId)
      throw new Error(
        `${action} refused: ticket ${row.id} belongs to rollout "${row.rollout_id}", not "${rolloutId}"`,
      )
  }

  add(input: AddInput): TicketRow {
    if (!input.todo) throw new Error("add requires 'todo' (the one-line summary)")
    if (!input.rollout_id) throw new Error("add requires 'rollout_id' (your session id)")
    const ts = this.now()
    this.db.run(
      `INSERT INTO ticket (created_at, updated_at, todo, status, rollout_id, last_actor, md_content)
       VALUES (?, ?, ?, 'pending', ?, NULL, ?)`,
      [ts, ts, input.todo, input.rollout_id, input.md_content ?? null],
    )
    return this.get(Number((this.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id))!
  }

  get(id: number): TicketRow | undefined {
    return (
      (this.db
        .query("SELECT id, created_at, updated_at, todo, status, rollout_id, last_actor, md_content FROM ticket WHERE id = ?")
        .get(id) as TicketRow | null) ?? undefined
    )
  }

  list(filter: ListFilter = {}): TicketRow[] {
    const where: string[] = []
    const params: string[] = []
    if (!filter.all && filter.rollout_id !== undefined) {
      where.push("rollout_id = ?")
      params.push(filter.rollout_id)
    }
    if (filter.status !== undefined) {
      where.push("status = ?")
      params.push(filter.status)
    }
    const sql = `SELECT id, created_at, updated_at, todo, status, rollout_id, last_actor, md_content FROM ticket ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id`
    return this.db.query(sql).all(...params) as TicketRow[]
  }

  setStatus(id: number, input: SetStatusInput): TicketRow | undefined {
    this.assertStatus(input.status)
    const current = this.get(id)
    if (!current) return undefined
    this.assertOwner(current, input.rollout_id, "set_status")
    this.db.run(
      `UPDATE ticket SET status = ?, last_actor = ?, updated_at = ? WHERE id = ?`,
      [input.status, input.last_actor ?? current.last_actor, this.now(), id],
    )
    return this.get(id)
  }

  syncStatuses(items: Array<{ content?: unknown; status?: unknown }>, rolloutId: string): number[] {
    if (!rolloutId) throw new Error("syncStatuses requires the flushing session's rollout id")
    const changed: number[] = []
    for (const item of items) {
      if (typeof item?.content !== "string" || typeof item?.status !== "string") continue
      if (!STATUSES.has(item.status)) continue
      const m = item.content.match(/^\s*(\d+)\s*[.:)\]-]/)
      if (!m) continue
      const row = this.get(Number(m[1]))
      if (!row || row.rollout_id !== rolloutId || row.status === item.status) continue
      this.setStatus(row.id, { rollout_id: rolloutId, status: item.status })
      changed.push(row.id)
    }
    return changed
  }

  appendComment(ticketId: number, content: string, authorRolloutId?: string | null): TicketComment {
    const row = this.get(ticketId)
    if (!row) throw new Error(`no ticket with number ${ticketId}`)
    const ts = this.now()
    this.db.run(
      `INSERT INTO ticket_comment (ticket_id, created_at, content, author_rollout_id)
       VALUES (?, ?, ?, ?)`,
      [ticketId, ts, content, authorRolloutId ?? null],
    )
    return this.db
      .query("SELECT id, ticket_id, created_at, content, author_rollout_id FROM ticket_comment WHERE id = ?")
      .get(Number((this.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id)) as TicketComment
  }

  getComments(ticketId: number): TicketComment[] {
    return this.db
      .query("SELECT id, ticket_id, created_at, content, author_rollout_id FROM ticket_comment WHERE ticket_id = ? ORDER BY created_at, id")
      .all(ticketId) as TicketComment[]
  }

  close() {
    this.db.close()
  }
}
