import { describe, test, expect } from 'bun:test'
import { parseCodexSessionText } from '../../src/parsers/codex.ts'
import { join } from 'node:path'

const fixtures = join(import.meta.dir, '../fixtures')

// Load fixture text once
const sessionText = await Bun.file(join(fixtures, 'codex-session.jsonl')).text()
const emptyText   = await Bun.file(join(fixtures, 'codex-empty.jsonl')).text()

const FAKE_MTIME = 1_700_000_000_000

describe('parseCodexSessionText', () => {
  test('parses session_meta fields correctly', () => {
    const session = parseCodexSessionText(sessionText, '/fake/path.jsonl', FAKE_MTIME)
    expect(session).not.toBeNull()
    expect(session!.id).toBe('019d8980-2d18-7eb2-ad01-a38f463deb0d')
    expect(session!.tool).toBe('codex')
    expect(session!.cwd).toBe('/home/user/myproject')
    expect(session!.updatedAt).toBe(new Date('2026-04-14T00:59:32.039Z').getTime())
  })

  test('passes through filePath and fileMtime', () => {
    const session = parseCodexSessionText(sessionText, '/fake/path.jsonl', FAKE_MTIME)
    expect(session!.filePath).toBe('/fake/path.jsonl')
    expect(session!.fileMtime).toBe(FAKE_MTIME)
  })

  test('extracts last user message (not first)', () => {
    const session = parseCodexSessionText(sessionText, '/fake/path.jsonl', FAKE_MTIME)
    expect(session!.lastUser).toBe('add cursor-based pagination to the users endpoint')
  })

  test('extracts last agent message (not first)', () => {
    const session = parseCodexSessionText(sessionText, '/fake/path.jsonl', FAKE_MTIME)
    expect(session!.lastAgent).toBe('Added /users?cursor= endpoint with 50-item pages')
  })

  test('returns null on empty text', () => {
    expect(parseCodexSessionText('', '/fake/path.jsonl', FAKE_MTIME)).toBeNull()
  })

  test('returns null when first line is not valid JSON', () => {
    expect(parseCodexSessionText('not json\nsecond line\n', '/fake/path.jsonl', FAKE_MTIME)).toBeNull()
  })

  test('returns null when type is not session_meta', () => {
    const text = JSON.stringify({ type: 'event_msg', payload: { id: 'x', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' } }) + '\n'
    expect(parseCodexSessionText(text, '/fake/path.jsonl', FAKE_MTIME)).toBeNull()
  })

  test('returns null when session has no newline after first line', () => {
    const text = JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' } })
    expect(parseCodexSessionText(text, '/fake/path.jsonl', FAKE_MTIME)).toBeNull()
  })

  test('handles session with no messages gracefully', () => {
    const session = parseCodexSessionText(emptyText, '/fake/path.jsonl', FAKE_MTIME)
    expect(session).not.toBeNull()
    expect(session!.lastUser).toBeUndefined()
    expect(session!.lastAgent).toBeUndefined()
  })

  test('truncates long messages to ~80 chars', () => {
    const longMsg = 'a'.repeat(200)
    const text = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'trunc-test', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/tmp' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: longMsg } }),
    ].join('\n')

    const session = parseCodexSessionText(text, '/fake/path.jsonl', FAKE_MTIME)
    expect(session!.lastUser!.length).toBeLessThanOrEqual(81)
    expect(session!.lastUser!).toEndWith('…')
  })
})
