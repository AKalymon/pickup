import { describe, test, expect, beforeAll } from 'bun:test'
import { parseClaudeSessions } from '../../src/parsers/claude.ts'
import { join } from 'node:path'
import { mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const fixtures = join(import.meta.dir, '../fixtures')

// Set up a temp sessions dir with the fixture files
let sessionsDir: string
let historyPath: string

beforeAll(() => {
  sessionsDir = join(tmpdir(), `pickup-test-claude-${Date.now()}`)
  mkdirSync(sessionsDir, { recursive: true })
  copyFileSync(join(fixtures, 'claude-session-1.json'), join(sessionsDir, 'claude-session-1.json'))
  copyFileSync(join(fixtures, 'claude-session-2.json'), join(sessionsDir, 'claude-session-2.json'))
  historyPath = join(fixtures, 'claude-history.jsonl')
})

describe('parseClaudeSessions', () => {
  test('returns one session per session file', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, historyPath)
    expect(sessions).toHaveLength(2)
  })

  test('parses sessionId and cwd correctly', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, historyPath)
    const s1 = sessions.find(s => s.id === '482ffd84-c496-451b-86cb-10495efa6cd5')
    expect(s1).toBeDefined()
    expect(s1!.cwd).toBe('/home/user/myproject')
    expect(s1!.tool).toBe('claude')
  })

  test('uses most recent history entry as lastUser', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, historyPath)
    const s1 = sessions.find(s => s.id === '482ffd84-c496-451b-86cb-10495efa6cd5')
    // session 1 has two history entries — should use the later one
    expect(s1!.lastUser).toBe('add pagination to the users endpoint')
  })

  test('updatedAt reflects history timestamp when available', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, historyPath)
    const s1 = sessions.find(s => s.id === '482ffd84-c496-451b-86cb-10495efa6cd5')
    expect(s1!.updatedAt).toBe(1776038400000)
  })

  test('falls back to startedAt when no history entry exists', async () => {
    // Use a sessions dir with only session 1 and empty history
    const emptyHistoryPath = join(tmpdir(), 'pickup-empty-history.jsonl')
    await Bun.write(emptyHistoryPath, '')
    const sessions = await parseClaudeSessions(sessionsDir, emptyHistoryPath)
    const s2 = sessions.find(s => s.id === '019bb972-be6f-46c5-9bcd-73cb4f75068a')
    expect(s2!.updatedAt).toBe(1775870000000) // startedAt from session file
    expect(s2!.lastUser).toBeUndefined()
  })

  test('lastAgent is always undefined for claude (not stored)', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, historyPath)
    for (const s of sessions) {
      expect(s.lastAgent).toBeUndefined()
    }
  })

  test('handles missing history.jsonl gracefully', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, '/tmp/does-not-exist-history.jsonl')
    expect(sessions).toHaveLength(2)
    for (const s of sessions) {
      expect(s.lastUser).toBeUndefined()
    }
  })

  test('returns empty array when sessions dir has no JSON files', async () => {
    const emptyDir = join(tmpdir(), `pickup-empty-${Date.now()}`)
    mkdirSync(emptyDir, { recursive: true })
    const sessions = await parseClaudeSessions(emptyDir, historyPath)
    expect(sessions).toHaveLength(0)
  })

  test('fileMtime is a positive number', async () => {
    const sessions = await parseClaudeSessions(sessionsDir, historyPath)
    for (const s of sessions) {
      expect(s.fileMtime).toBeGreaterThan(0)
    }
  })
})
