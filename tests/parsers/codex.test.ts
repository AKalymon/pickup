import { describe, test, expect } from 'bun:test'
import { parseCodexSession } from '../../src/parsers/codex.ts'
import { join } from 'node:path'

const fixtures = join(import.meta.dir, '../fixtures')

describe('parseCodexSession', () => {
  test('parses session_meta fields correctly', async () => {
    const session = await parseCodexSession(join(fixtures, 'codex-session.jsonl'))
    expect(session).not.toBeNull()
    expect(session!.id).toBe('019d8980-2d18-7eb2-ad01-a38f463deb0d')
    expect(session!.tool).toBe('codex')
    expect(session!.cwd).toBe('/home/user/myproject')
    expect(session!.updatedAt).toBe(new Date('2026-04-14T00:59:32.039Z').getTime())
  })

  test('extracts last user message (not first)', async () => {
    const session = await parseCodexSession(join(fixtures, 'codex-session.jsonl'))
    expect(session!.lastUser).toBe('add cursor-based pagination to the users endpoint')
  })

  test('extracts last agent message (not first)', async () => {
    const session = await parseCodexSession(join(fixtures, 'codex-session.jsonl'))
    expect(session!.lastAgent).toBe('Added /users?cursor= endpoint with 50-item pages')
  })

  test('returns null on missing file', async () => {
    const session = await parseCodexSession('/tmp/does-not-exist.jsonl')
    expect(session).toBeNull()
  })

  test('handles session with no messages gracefully', async () => {
    const session = await parseCodexSession(join(fixtures, 'codex-empty.jsonl'))
    expect(session).not.toBeNull()
    expect(session!.lastUser).toBeUndefined()
    expect(session!.lastAgent).toBeUndefined()
  })

  test('truncates long messages to ~80 chars', async () => {
    // Write a temp fixture with a very long message
    const longMsg = 'a'.repeat(200)
    const content = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'trunc-test', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/tmp' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: longMsg } }),
    ].join('\n')

    const tmpPath = '/tmp/pickup-test-truncate.jsonl'
    await Bun.write(tmpPath, content)

    const session = await parseCodexSession(tmpPath)
    expect(session!.lastUser!.length).toBeLessThanOrEqual(81) // 80 + ellipsis char
    expect(session!.lastUser!).toEndWith('…')
  })

  test('fileMtime is a positive number', async () => {
    const session = await parseCodexSession(join(fixtures, 'codex-session.jsonl'))
    expect(session!.fileMtime).toBeGreaterThan(0)
  })
})
