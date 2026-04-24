import { describe, test, expect } from 'bun:test'
import { resolveLaunchSelection } from '../src/selection.ts'
import type { Session } from '../src/parsers/types.ts'

function makeSession(id: string): Session {
  return {
    id,
    tool: 'codex',
    cwd: '/workspace',
    updatedAt: Date.now(),
    filePath: '/workspace/fake.jsonl',
    fileMtime: Date.now(),
  }
}

describe('resolveLaunchSelection', () => {
  test('returns current-terminal mode for focused session when nothing is checked', () => {
    const selection = resolveLaunchSelection([makeSession('a'), makeSession('b')], 1, new Set())
    expect(selection).toEqual({
      sessions: [expect.objectContaining({ id: 'b' })],
      mode: 'current-terminal',
    })
  })

  test('returns separate-terminal-sessions mode for checked sessions', () => {
    const selection = resolveLaunchSelection(
      [makeSession('a'), makeSession('b')],
      0,
      new Set(['b']),
    )
    expect(selection).toEqual({
      sessions: [expect.objectContaining({ id: 'b' })],
      mode: 'separate-terminal-sessions',
    })
  })

  test('returns null when focus is out of range and nothing is checked', () => {
    const selection = resolveLaunchSelection([makeSession('a')], 99, new Set())
    expect(selection).toBeNull()
  })
})
