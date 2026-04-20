import { describe, test, expect } from 'bun:test'
import {
  findStaleFiles,
  prioritizeFilesForParsing,
  discoverSessionFiles,
  syncSessionsToDatabase,
  type SessionFileRef,
} from '../src/indexer.ts'
import { openDb, querySessions } from '../src/db.ts'
import type { FileSystem } from '../src/ports.ts'
import { join } from 'node:path'

// ---- Fake FileSystem helpers ----

function makeFakeFs(
  files: Record<string, string>,
  stats?: Record<string, number>,
): FileSystem {
  return {
    readTextFile: async (path) => {
      if (path in files) return files[path]!
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    },
    statFile: async (path) => {
      const mtime = stats?.[path] ?? (path in files ? 1000 : undefined)
      if (mtime === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
      return { mtimeMs: mtime, size: files[path]?.length ?? 0 }
    },
    globFiles: async (pattern, cwd) => {
      const prefix = cwd.endsWith('/') ? cwd : cwd + '/'
      return Object.keys(files).filter(p => {
        if (!p.startsWith(prefix)) return false
        if (pattern === '**/*.jsonl') return p.endsWith('.jsonl')
        if (pattern === '*.json')     return p.endsWith('.json') && !p.slice(prefix.length).includes('/')
        if (pattern === '*/workspace.yaml') return p.endsWith('/workspace.yaml')
        return false
      })
    },
  }
}

// Fixture content
const FAKE_HOME = '/home/testuser'

const codexSessionContent = [
  JSON.stringify({ type: 'session_meta', payload: { id: 'codex-1', timestamp: '2026-04-14T00:00:00.000Z', cwd: '/my/project' } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hello world' } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'hi there' } }),
].join('\n')

const claudeSessionContent = JSON.stringify({
  sessionId: 'claude-1',
  cwd: '/my/claude-project',
  startedAt: 1776000000000,
  kind: 'interactive',
})

const claudeHistoryContent = JSON.stringify({
  sessionId: 'claude-1',
  display: 'write tests',
  timestamp: 1776100000000,
}) + '\n'

const copilotWorkspaceContent = [
  'id: copilot-1',
  'cwd: /my/copilot-project',
  'created_at: 2026-04-10T00:00:00.000Z',
  'updated_at: 2026-04-10T00:01:00.000Z',
].join('\n')

const copilotEventsContent = [
  JSON.stringify({ type: 'user.message', data: { content: 'fix the bug' } }),
  JSON.stringify({ type: 'assistant.message', data: { content: 'done' } }),
].join('\n')

// ---- Pure function tests ----

describe('findStaleFiles', () => {
  const files: SessionFileRef[] = [
    { path: '/a', tool: 'codex', mtime: 100 },
    { path: '/b', tool: 'codex', mtime: 200 },
    { path: '/c', tool: 'claude', mtime: 300 },
  ]

  test('returns all files when refresh is true', () => {
    const cached = new Map([['/a', 100], ['/b', 200], ['/c', 300]])
    expect(findStaleFiles(files, cached, true)).toHaveLength(3)
  })

  test('returns only changed files when refresh is false', () => {
    const cached = new Map([['/a', 100], ['/b', 999]])
    const stale = findStaleFiles(files, cached, false)
    expect(stale.map(f => f.path)).toEqual(['/b', '/c']) // /b changed, /c new
  })

  test('returns empty when everything is up-to-date', () => {
    const cached = new Map([['/a', 100], ['/b', 200], ['/c', 300]])
    expect(findStaleFiles(files, cached, false)).toHaveLength(0)
  })

  test('does not mutate the input array', () => {
    const copy = [...files]
    findStaleFiles(files, new Map(), true)
    expect(files).toEqual(copy)
  })
})

describe('prioritizeFilesForParsing', () => {
  const files: SessionFileRef[] = [
    { path: '/old', tool: 'codex', mtime: 100 },
    { path: '/new', tool: 'codex', mtime: 900 },
    { path: '/mid', tool: 'codex', mtime: 500 },
  ]

  test('sorts newest first', () => {
    const result = prioritizeFilesForParsing(files, 10)
    expect(result.map(f => f.path)).toEqual(['/new', '/mid', '/old'])
  })

  test('respects maxCount', () => {
    const result = prioritizeFilesForParsing(files, 2)
    expect(result).toHaveLength(2)
    expect(result[0]!.path).toBe('/new')
  })

  test('does not mutate the input array', () => {
    const copy = files.map(f => ({ ...f }))
    prioritizeFilesForParsing(files, 10)
    expect(files).toEqual(copy)
  })
})

// ---- discoverSessionFiles ----

describe('discoverSessionFiles', () => {
  const files = {
    [`${FAKE_HOME}/.codex/sessions/2026/04/session.jsonl`]: codexSessionContent,
    [`${FAKE_HOME}/.claude/sessions/claude-1.json`]: claudeSessionContent,
    [`${FAKE_HOME}/.copilot/session-state/copilot-1/workspace.yaml`]: copilotWorkspaceContent,
  }
  const fs = makeFakeFs(files, {
    [`${FAKE_HOME}/.codex/sessions/2026/04/session.jsonl`]: 1111,
    [`${FAKE_HOME}/.claude/sessions/claude-1.json`]: 2222,
    [`${FAKE_HOME}/.copilot/session-state/copilot-1/workspace.yaml`]: 3333,
  })

  test('discovers files for all three tools', async () => {
    const refs = await discoverSessionFiles({ homeDir: FAKE_HOME }, fs)
    expect(refs).toHaveLength(3)
    const tools = new Set(refs.map(r => r.tool))
    expect(tools).toEqual(new Set(['codex', 'claude', 'copilot']))
  })

  test('filters by tool option', async () => {
    const refs = await discoverSessionFiles({ homeDir: FAKE_HOME, tool: 'codex' }, fs)
    expect(refs.every(r => r.tool === 'codex')).toBe(true)
  })

  test('attaches correct mtime from statFile', async () => {
    const refs = await discoverSessionFiles({ homeDir: FAKE_HOME }, fs)
    const codexRef = refs.find(r => r.tool === 'codex')
    expect(codexRef!.mtime).toBe(1111)
  })

  test('returns empty array when directories do not exist', async () => {
    const emptyFs = makeFakeFs({})
    const refs = await discoverSessionFiles({ homeDir: '/no-such-home' }, emptyFs)
    expect(refs).toHaveLength(0)
  })
})

// ---- syncSessionsToDatabase ----

describe('syncSessionsToDatabase', () => {
  function makeFiles() {
    return {
      [`${FAKE_HOME}/.codex/sessions/sess.jsonl`]: codexSessionContent,
      [`${FAKE_HOME}/.claude/sessions/s1.json`]: claudeSessionContent,
      [`${FAKE_HOME}/.claude/history.jsonl`]: claudeHistoryContent,
      [`${FAKE_HOME}/.copilot/session-state/copilot-1/workspace.yaml`]: copilotWorkspaceContent,
      [`${FAKE_HOME}/.copilot/session-state/copilot-1/events.jsonl`]: copilotEventsContent,
    }
  }

  test('indexes codex sessions', async () => {
    const db = openDb(':memory:')
    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, makeFakeFs(makeFiles()))
    const sessions = querySessions(db, { limit: 100 })
    const codex = sessions.find(s => s.tool === 'codex')
    expect(codex).toBeDefined()
    expect(codex!.id).toBe('codex-1')
    expect(codex!.cwd).toBe('/my/project')
    expect(codex!.lastUser).toBe('hello world')
    expect(codex!.lastAgent).toBe('hi there')
  })

  test('indexes claude sessions with history', async () => {
    const db = openDb(':memory:')
    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, makeFakeFs(makeFiles()))
    const sessions = querySessions(db, { limit: 100 })
    const claude = sessions.find(s => s.tool === 'claude')
    expect(claude).toBeDefined()
    expect(claude!.id).toBe('claude-1')
    expect(claude!.lastUser).toBe('write tests')
    expect(claude!.updatedAt).toBe(1776100000000)
  })

  test('indexes copilot sessions with events', async () => {
    const db = openDb(':memory:')
    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, makeFakeFs(makeFiles()))
    const sessions = querySessions(db, { limit: 100 })
    const copilot = sessions.find(s => s.tool === 'copilot')
    expect(copilot).toBeDefined()
    expect(copilot!.id).toBe('copilot-1')
    expect(copilot!.lastUser).toBe('fix the bug')
  })

  test('second sync skips unchanged files', async () => {
    const db = openDb(':memory:')
    const fs = makeFakeFs(makeFiles())
    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, fs)
    const count1 = querySessions(db, { limit: 100 }).length

    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, fs)
    const count2 = querySessions(db, { limit: 100 }).length

    expect(count2).toBe(count1)
  })

  test('removes sessions for deleted files', async () => {
    const db = openDb(':memory:')
    const files = makeFiles()
    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, makeFakeFs(files))

    // Remove codex file
    const withoutCodex = { ...files }
    delete (withoutCodex as any)[`${FAKE_HOME}/.codex/sessions/sess.jsonl`]
    await syncSessionsToDatabase(db, { homeDir: FAKE_HOME }, makeFakeFs(withoutCodex))

    const sessions = querySessions(db, { limit: 100 })
    expect(sessions.find(s => s.tool === 'codex')).toBeUndefined()
  })
})
