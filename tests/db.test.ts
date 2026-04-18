import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { openDb, getMtimeMap, upsertMany, querySessions, removeStale } from '../src/db.ts'
import { type Session } from '../src/parsers/types.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function memDb(): Database {
  return openDb(':memory:')
}

const s1: Session = {
  id: 'aaa-001',
  tool: 'codex',
  cwd: '/home/user/proj1',
  updatedAt: 1776000000000,
  lastUser: 'fix the bug',
  lastAgent: 'Fixed in auth.ts',
  filePath: '/home/user/.codex/sessions/2026/04/01/s1.jsonl',
  fileMtime: 1776000000000,
}

const s2: Session = {
  id: 'bbb-002',
  tool: 'claude',
  cwd: '/home/user/proj2',
  updatedAt: 1776100000000,
  lastUser: 'add tests',
  lastAgent: undefined,
  filePath: '/home/user/.claude/sessions/s2.json',
  fileMtime: 1776100000000,
}

const s3: Session = {
  id: 'ccc-003',
  tool: 'copilot',
  cwd: '/home/user/proj3',
  updatedAt: 1775900000000,
  lastUser: undefined,
  lastAgent: undefined,
  filePath: '/home/user/.copilot/session-state/ccc-003/workspace.yaml',
  fileMtime: 1775900000000,
}

describe('openDb', () => {
  test('creates schema without error', () => {
    expect(() => memDb()).not.toThrow()
  })

  test('creates schema idempotently (double open)', () => {
    const tmpPath = join(tmpdir(), `pickup-db-test-${Date.now()}.db`)
    expect(() => openDb(tmpPath)).not.toThrow()
    expect(() => openDb(tmpPath)).not.toThrow()
  })
})

describe('upsertMany', () => {
  test('inserts sessions', () => {
    const db = memDb()
    upsertMany(db, [s1, s2])
    const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM sessions').get()
    expect(count!.c).toBe(2)
  })

  test('is idempotent — same data twice yields same row count', () => {
    const db = memDb()
    upsertMany(db, [s1])
    upsertMany(db, [s1])
    const count = db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM sessions').get()
    expect(count!.c).toBe(1)
  })

  test('updates existing row on conflict', () => {
    const db = memDb()
    upsertMany(db, [s1])
    const updated: Session = { ...s1, lastUser: 'new message', fileMtime: 9999 }
    upsertMany(db, [updated])
    const rows = db.query<{ last_user: string; file_mtime: number }, []>(
      'SELECT last_user, file_mtime FROM sessions WHERE id = ?'
    ).all(s1.id)
    expect(rows[0]!.last_user).toBe('new message')
    expect(rows[0]!.file_mtime).toBe(9999)
  })

  test('handles empty array without error', () => {
    const db = memDb()
    expect(() => upsertMany(db, [])).not.toThrow()
  })

  test('stores null for undefined optional fields', () => {
    const db = memDb()
    upsertMany(db, [s3]) // no lastUser or lastAgent
    const row = db.query<{ last_user: null; last_agent: null }, []>(
      'SELECT last_user, last_agent FROM sessions WHERE id = ?'
    ).get(s3.id)
    expect(row!.last_user).toBeNull()
    expect(row!.last_agent).toBeNull()
  })
})

describe('getMtimeMap', () => {
  test('returns empty map when no sessions', () => {
    const db = memDb()
    expect(getMtimeMap(db).size).toBe(0)
  })

  test('maps filePath to fileMtime', () => {
    const db = memDb()
    upsertMany(db, [s1, s2])
    const map = getMtimeMap(db)
    expect(map.get(s1.filePath)).toBe(s1.fileMtime)
    expect(map.get(s2.filePath)).toBe(s2.fileMtime)
  })
})

describe('querySessions', () => {
  test('returns sessions sorted by updatedAt DESC', () => {
    const db = memDb()
    upsertMany(db, [s1, s2, s3])
    const sessions = querySessions(db, { limit: 10 })
    expect(sessions[0]!.id).toBe(s2.id) // updatedAt: 1776100000000
    expect(sessions[1]!.id).toBe(s1.id) // updatedAt: 1776000000000
    expect(sessions[2]!.id).toBe(s3.id) // updatedAt: 1775900000000
  })

  test('respects limit', () => {
    const db = memDb()
    upsertMany(db, [s1, s2, s3])
    const sessions = querySessions(db, { limit: 2 })
    expect(sessions).toHaveLength(2)
  })

  test('filters by tool', () => {
    const db = memDb()
    upsertMany(db, [s1, s2, s3])
    const sessions = querySessions(db, { tool: 'codex', limit: 10 })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.tool).toBe('codex')
  })

  test('converts null DB fields back to undefined', () => {
    const db = memDb()
    upsertMany(db, [s3])
    const sessions = querySessions(db, { limit: 10 })
    expect(sessions[0]!.lastUser).toBeUndefined()
    expect(sessions[0]!.lastAgent).toBeUndefined()
  })

  test('default limit is 10', () => {
    const db = memDb()
    const many: Session[] = Array.from({ length: 15 }, (_, i) => ({
      ...s1,
      id: `id-${i}`,
      updatedAt: i * 1000,
      filePath: `/fake/path/${i}.jsonl`,
    }))
    upsertMany(db, many)
    const sessions = querySessions(db)
    expect(sessions).toHaveLength(10)
  })
})

describe('removeStale', () => {
  test('removes sessions whose filePath is no longer known', () => {
    const db = memDb()
    upsertMany(db, [s1, s2])
    removeStale(db, new Set([s1.filePath]))
    const sessions = querySessions(db, { limit: 100 })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.id).toBe(s1.id)
  })

  test('is safe when all paths are known', () => {
    const db = memDb()
    upsertMany(db, [s1])
    removeStale(db, new Set([s1.filePath]))
    expect(querySessions(db, { limit: 100 })).toHaveLength(1)
  })

  test('is safe on empty db', () => {
    const db = memDb()
    expect(() => removeStale(db, new Set(['/foo']))).not.toThrow()
  })
})
