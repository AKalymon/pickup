import { test, expect, describe } from 'bun:test'
import { scanTailForLastMessages } from '../../src/parsers/tail-scan.ts'

// Classifier matching codex event format
const codexClassify = (parsed: unknown) => {
  const e = parsed as { type: string; payload: { type: string; message: string } }
  if (e.type !== 'event_msg') return null
  const kind = e.payload?.type
  const content = e.payload?.message
  if (!content) return null
  if (kind === 'user_message') return { role: 'user' as const, content }
  if (kind === 'agent_message') return { role: 'agent' as const, content }
  return null
}

// Classifier matching copilot event format
const copilotClassify = (parsed: unknown) => {
  const e = parsed as { type: string; data: { content?: string } }
  const content = e.data?.content
  if (!content) return null
  if (e.type === 'user.message') return { role: 'user' as const, content }
  if (e.type === 'assistant.message') return { role: 'agent' as const, content }
  return null
}

function lines(...objs: unknown[]): string {
  return objs.map(o => JSON.stringify(o)).join('\n')
}

describe('scanTailForLastMessages', () => {
  test('returns empty object for empty text', () => {
    expect(scanTailForLastMessages('', codexClassify)).toEqual({})
  })

  test('finds last user and agent messages (codex format)', () => {
    const text = lines(
      { type: 'event_msg', payload: { type: 'user_message', message: 'first user' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'first agent' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'last user' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'last agent' } },
    )
    expect(scanTailForLastMessages(text, codexClassify)).toEqual({
      lastUser: 'last user',
      lastAgent: 'last agent',
    })
  })

  test('finds last user and agent messages (copilot format)', () => {
    const text = lines(
      { type: 'user.message', data: { content: 'first user' } },
      { type: 'assistant.message', data: { content: 'first agent' } },
      { type: 'user.message', data: { content: 'last user' } },
      { type: 'assistant.message', data: { content: 'last agent' } },
    )
    expect(scanTailForLastMessages(text, copilotClassify)).toEqual({
      lastUser: 'last user',
      lastAgent: 'last agent',
    })
  })

  test('skips irrelevant lines', () => {
    const text = lines(
      { type: 'session_meta', payload: { id: '123' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'hello' } },
      { type: 'tool_call', payload: {} },
    )
    expect(scanTailForLastMessages(text, codexClassify)).toEqual({ lastUser: 'hello' })
  })

  test('skips malformed JSON lines', () => {
    const text = [
      'not json at all',
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'valid' } }),
      '{broken',
    ].join('\n')
    expect(scanTailForLastMessages(text, codexClassify)).toEqual({ lastUser: 'valid' })
  })

  test('returns only user when no agent message present', () => {
    const text = lines(
      { type: 'event_msg', payload: { type: 'user_message', message: 'hi' } },
    )
    expect(scanTailForLastMessages(text, codexClassify)).toEqual({ lastUser: 'hi' })
  })

  test('stops scanning once both messages found', () => {
    // Put earlier messages first — scan reverses, so these should be ignored
    const text = lines(
      { type: 'event_msg', payload: { type: 'user_message', message: 'old user' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'old agent' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'new user' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'new agent' } },
    )
    const result = scanTailForLastMessages(text, codexClassify)
    expect(result.lastUser).toBe('new user')
    expect(result.lastAgent).toBe('new agent')
  })
})
