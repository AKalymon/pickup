import { describe, test, expect } from 'bun:test'
import {
  parseClaudeSessionJson,
  parseClaudeHistory,
  joinClaudeSessionsWithHistory,
} from '../../src/parsers/claude.ts'
import { join } from 'node:path'

const fixtures = join(import.meta.dir, '../fixtures')

const session1Raw   = await Bun.file(join(fixtures, 'claude-session-1.json')).text()
const session2Raw   = await Bun.file(join(fixtures, 'claude-session-2.json')).text()
const historyText   = await Bun.file(join(fixtures, 'claude-history.jsonl')).text()

const FAKE_MTIME = 1_700_000_000_000

describe('parseClaudeSessionJson', () => {
  test('parses sessionId and cwd', () => {
    const data = parseClaudeSessionJson(session1Raw)
    expect(data).not.toBeNull()
    expect(data!.sessionId).toBe('482ffd84-c496-451b-86cb-10495efa6cd5')
    expect(data!.cwd).toBe('/home/user/myproject')
  })

  test('parses startedAt', () => {
    const data = parseClaudeSessionJson(session1Raw)
    expect(data!.startedAt).toBe(1776038216093)
  })

  test('returns null for empty string', () => {
    expect(parseClaudeSessionJson('')).toBeNull()
  })

  test('returns null for invalid JSON', () => {
    expect(parseClaudeSessionJson('{broken')).toBeNull()
  })

  test('returns null when sessionId is missing', () => {
    expect(parseClaudeSessionJson(JSON.stringify({ cwd: '/tmp', startedAt: 0 }))).toBeNull()
  })
})

describe('parseClaudeHistory', () => {
  test('returns a map keyed by sessionId', () => {
    const history = parseClaudeHistory(historyText)
    expect(history.has('482ffd84-c496-451b-86cb-10495efa6cd5')).toBe(true)
    expect(history.has('019bb972-be6f-46c5-9bcd-73cb4f75068a')).toBe(true)
  })

  test('keeps the most recent entry per session', () => {
    const history = parseClaudeHistory(historyText)
    // session 1 has two entries; latest is timestamp 1776038400000
    const entry = history.get('482ffd84-c496-451b-86cb-10495efa6cd5')
    expect(entry!.display).toBe('add pagination to the users endpoint')
    expect(entry!.timestamp).toBe(1776038400000)
  })

  test('returns empty map for empty text', () => {
    expect(parseClaudeHistory('').size).toBe(0)
  })

  test('skips malformed lines without throwing', () => {
    const text = 'not json\n' + JSON.stringify({ sessionId: 's1', display: 'hi', timestamp: 1 }) + '\n'
    const history = parseClaudeHistory(text)
    expect(history.get('s1')!.display).toBe('hi')
  })

  test('skips entries missing display', () => {
    const text = JSON.stringify({ sessionId: 's1', timestamp: 1 }) + '\n'
    expect(parseClaudeHistory(text).size).toBe(0)
  })
})

describe('joinClaudeSessionsWithHistory', () => {
  const meta1 = { ...parseClaudeSessionJson(session1Raw)!, filePath: '/fake/s1.json', fileMtime: FAKE_MTIME }
  const meta2 = { ...parseClaudeSessionJson(session2Raw)!, filePath: '/fake/s2.json', fileMtime: FAKE_MTIME }
  const history = parseClaudeHistory(historyText)

  test('produces one session per meta', () => {
    const sessions = joinClaudeSessionsWithHistory([meta1, meta2], history)
    expect(sessions).toHaveLength(2)
  })

  test('uses history timestamp and display', () => {
    const sessions = joinClaudeSessionsWithHistory([meta1], history)
    expect(sessions[0]!.updatedAt).toBe(1776038400000)
    expect(sessions[0]!.lastUser).toBe('add pagination to the users endpoint')
  })

  test('falls back to startedAt when no history entry', () => {
    const sessions = joinClaudeSessionsWithHistory([meta2], new Map())
    expect(sessions[0]!.updatedAt).toBe(1775870000000)
    expect(sessions[0]!.lastUser).toBeUndefined()
  })

  test('lastAgent is always undefined', () => {
    const sessions = joinClaudeSessionsWithHistory([meta1], history)
    expect(sessions[0]!.lastAgent).toBeUndefined()
  })

  test('tool is always claude', () => {
    const sessions = joinClaudeSessionsWithHistory([meta1], history)
    expect(sessions[0]!.tool).toBe('claude')
  })

  test('truncates long history display text', () => {
    const longMeta = { ...meta1, sessionId: 'long-id' }
    const longHistory = new Map([['long-id', { display: 'x'.repeat(200), timestamp: 9999 }]])
    const sessions = joinClaudeSessionsWithHistory([longMeta], longHistory)
    expect(sessions[0]!.lastUser!.length).toBeLessThanOrEqual(81)
  })
})
