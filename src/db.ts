import { Database } from 'bun:sqlite'
import { type Session } from './parsers/types.ts'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  tool         TEXT NOT NULL,
  cwd          TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL,
  last_user    TEXT,
  last_agent   TEXT,
  file_path    TEXT NOT NULL DEFAULT '',
  file_mtime   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool    ON sessions(tool);
`

export interface QueryOptions {
  tool?: 'claude' | 'copilot' | 'codex'
  limit?: number
}

export function openDb(dbPath?: string): Database {
  const path = dbPath ?? join(process.env.HOME ?? '', '.pickup', 'index.db')
  // Ensure the directory exists (skip for in-memory databases)
  if (path !== ':memory:') {
    const dir = path.replace(/\/[^/]+$/, '')
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec(SCHEMA)
  return db
}

export function getMtimeMap(db: Database): Map<string, number> {
  const rows = db.query<{ file_path: string; file_mtime: number }, []>(
    'SELECT file_path, file_mtime FROM sessions',
  ).all()
  return new Map(rows.map(r => [r.file_path, r.file_mtime]))
}

export function upsertMany(db: Database, sessions: Session[]): void {
  if (sessions.length === 0) return

  const stmt = db.prepare(`
    INSERT INTO sessions (id, tool, cwd, updated_at, last_user, last_agent, file_path, file_mtime)
    VALUES ($id, $tool, $cwd, $updatedAt, $lastUser, $lastAgent, $filePath, $fileMtime)
    ON CONFLICT(id) DO UPDATE SET
      tool       = excluded.tool,
      cwd        = excluded.cwd,
      updated_at = excluded.updated_at,
      last_user  = excluded.last_user,
      last_agent = excluded.last_agent,
      file_path  = excluded.file_path,
      file_mtime = excluded.file_mtime
  `)

  // Run all upserts in a single transaction for speed
  db.transaction(() => {
    for (const s of sessions) {
      stmt.run({
        $id: s.id,
        $tool: s.tool,
        $cwd: s.cwd,
        $updatedAt: s.updatedAt,
        $lastUser: s.lastUser ?? null,
        $lastAgent: s.lastAgent ?? null,
        $filePath: s.filePath,
        $fileMtime: s.fileMtime,
      })
    }
  })()
}

export function querySessions(db: Database, opts: QueryOptions = {}): Session[] {
  const { tool, limit = 10 } = opts

  const rows = tool
    ? db.query<DbRow, [string, number]>(
        'SELECT * FROM sessions WHERE tool = ? ORDER BY updated_at DESC LIMIT ?',
      ).all(tool, limit)
    : db.query<DbRow, [number]>(
        'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?',
      ).all(limit)

  return rows.map(rowToSession)
}

export function removeStale(db: Database, knownPaths: Set<string>): void {
  const existing = db.query<{ file_path: string }, []>(
    'SELECT file_path FROM sessions',
  ).all()

  const toDelete = existing.filter(r => !knownPaths.has(r.file_path)).map(r => r.file_path)
  if (toDelete.length === 0) return

  const stmt = db.prepare('DELETE FROM sessions WHERE file_path = ?')
  db.transaction(() => {
    for (const p of toDelete) stmt.run(p)
  })()
}

interface DbRow {
  id: string
  tool: string
  cwd: string
  updated_at: number
  last_user: string | null
  last_agent: string | null
  file_path: string
  file_mtime: number
}

function rowToSession(r: DbRow): Session {
  return {
    id: r.id,
    tool: r.tool as Session['tool'],
    cwd: r.cwd,
    updatedAt: r.updated_at,
    lastUser: r.last_user ?? undefined,
    lastAgent: r.last_agent ?? undefined,
    filePath: r.file_path,
    fileMtime: r.file_mtime,
  }
}
