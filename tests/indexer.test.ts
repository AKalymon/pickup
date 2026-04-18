import { describe, test, expect, beforeAll } from 'bun:test'
import { sync, collectAndStat } from '../src/indexer.ts'
import { openDb, querySessions } from '../src/db.ts'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const fixtures = join(import.meta.dir, 'fixtures')

/** Create a temporary home-like directory tree for testing */
function makeTempHome(suffix: string) {
  const home = join(tmpdir(), `pickup-indexer-test-${suffix}-${Date.now()}`)
  const codexSessions = join(home, '.codex', 'sessions', '2026', '04', '13')
  mkdirSync(codexSessions, { recursive: true })
  return { home, codexSessions }
}

describe('collectAndStat', () => {
  test('returns FileRef array with mtime > 0', async () => {
    const { home, codexSessions } = makeTempHome('collect')
    await Bun.write(
      join(codexSessions, 'test.jsonl'),
      await Bun.file(join(fixtures, 'codex-session.jsonl')).text(),
    )
    const files = await collectAndStat({ homeDir: home })
    expect(files.length).toBeGreaterThanOrEqual(1)
    const codexFile = files.find(f => f.tool === 'codex')
    expect(codexFile).toBeDefined()
    expect(codexFile!.mtime).toBeGreaterThan(0)
  })

  test('filters by tool option', async () => {
    const { home, codexSessions } = makeTempHome('filter')
    await Bun.write(
      join(codexSessions, 'test.jsonl'),
      await Bun.file(join(fixtures, 'codex-session.jsonl')).text(),
    )
    const files = await collectAndStat({ homeDir: home, tool: 'codex' })
    expect(files.every(f => f.tool === 'codex')).toBe(true)
  })

  test('returns empty array when dirs do not exist', async () => {
    const files = await collectAndStat({ homeDir: '/tmp/pickup-no-such-home-xyz' })
    expect(files).toHaveLength(0)
  })
})

describe('sync — codex sessions', () => {
  let home: string
  let codexSessions: string

  beforeAll(async () => {
    const dirs = makeTempHome('sync1')
    home = dirs.home
    codexSessions = dirs.codexSessions
    await Bun.write(
      join(codexSessions, 'session-a.jsonl'),
      await Bun.file(join(fixtures, 'codex-session.jsonl')).text(),
    )
  })

  test('first run indexes sessions from files', async () => {
    const db = openDb(':memory:')
    await sync(db, { homeDir: home })
    const sessions = querySessions(db, { limit: 100 })
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    const codexSession = sessions.find(s => s.tool === 'codex')
    expect(codexSession).toBeDefined()
    expect(codexSession!.cwd).toBe('/home/user/myproject')
  })

  test('second run skips unchanged files', async () => {
    const db = openDb(':memory:')
    await sync(db, { homeDir: home })
    const before = querySessions(db, { limit: 100 })

    // Sync again — should be a no-op (mtime unchanged)
    await sync(db, { homeDir: home })
    const after = querySessions(db, { limit: 100 })

    expect(after).toHaveLength(before.length)
  })

  test('re-parses a file when its mtime changes', async () => {
    const db = openDb(':memory:')
    await sync(db, { homeDir: home })

    // Write a new session file simulating a new session
    await Bun.write(
      join(codexSessions, 'session-b.jsonl'),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: 'new-session-id', timestamp: '2026-04-15T00:00:00.000Z', cwd: '/home/user/newproject' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'new work here' } }),
      ].join('\n'),
    )

    await sync(db, { homeDir: home })
    const sessions = querySessions(db, { limit: 100 })
    const newSession = sessions.find(s => s.id === 'new-session-id')
    expect(newSession).toBeDefined()
    expect(newSession!.lastUser).toBe('new work here')
  })

  test('--refresh forces re-parse of all files', async () => {
    const db = openDb(':memory:')
    await sync(db, { homeDir: home })
    const first = querySessions(db, { limit: 100 }).length

    await sync(db, { homeDir: home, refresh: true })
    const second = querySessions(db, { limit: 100 }).length

    expect(second).toBe(first) // same count, just re-parsed
  })
})

describe('sync — stale removal', () => {
  test('removes sessions for files that no longer exist', async () => {
    const { home, codexSessions } = makeTempHome('stale')
    const filePath = join(codexSessions, 'temp-session.jsonl')
    await Bun.write(
      filePath,
      JSON.stringify({ type: 'session_meta', payload: { id: 'stale-id', timestamp: '2026-04-01T00:00:00.000Z', cwd: '/tmp' } }) + '\n',
    )

    const db = openDb(':memory:')
    await sync(db, { homeDir: home })
    expect(querySessions(db, { limit: 100 }).find(s => s.id === 'stale-id')).toBeDefined()

    // Delete the file
    const fs = await import('node:fs/promises')
    await fs.unlink(filePath)

    await sync(db, { homeDir: home })
    expect(querySessions(db, { limit: 100 }).find(s => s.id === 'stale-id')).toBeUndefined()
  })
})
