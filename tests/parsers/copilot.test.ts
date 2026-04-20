import { describe, test, expect } from 'bun:test'
import { parseCopilotWorkspaceYaml, parseCopilotEvents } from '../../src/parsers/copilot.ts'
import { join } from 'node:path'

const fixtures = join(import.meta.dir, '../fixtures')
const copilotFixture = join(fixtures, 'copilot-session')

const workspaceText = await Bun.file(join(copilotFixture, 'workspace.yaml')).text()
const eventsText    = await Bun.file(join(copilotFixture, 'events.jsonl')).text()

describe('parseCopilotWorkspaceYaml', () => {
  test('parses id and cwd', () => {
    const data = parseCopilotWorkspaceYaml(workspaceText)
    expect(data).not.toBeNull()
    expect(data!.id).toBe('222b9523-4475-473b-b0ba-25943ef45429')
    expect(data!.cwd).toBe('/home/user/myproject')
  })

  test('parses created_at and updated_at', () => {
    const data = parseCopilotWorkspaceYaml(workspaceText)
    expect(data!.created_at).toBe('2026-04-11T00:28:54.538Z')
    expect(data!.updated_at).toBe('2026-04-11T00:28:54.548Z')
  })

  test('returns null for empty string', () => {
    expect(parseCopilotWorkspaceYaml('')).toBeNull()
  })

  test('returns null for malformed YAML', () => {
    expect(parseCopilotWorkspaceYaml('{{{{ not yaml')).toBeNull()
  })

  test('returns null when id is missing', () => {
    expect(parseCopilotWorkspaceYaml('cwd: /tmp\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n')).toBeNull()
  })

  test('returns null when cwd is missing', () => {
    expect(parseCopilotWorkspaceYaml('id: abc\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n')).toBeNull()
  })
})

describe('parseCopilotEvents', () => {
  test('extracts last user message', () => {
    const result = parseCopilotEvents(eventsText)
    expect(result.lastUser).toBe('also update the tests')
  })

  test('extracts last agent message', () => {
    const result = parseCopilotEvents(eventsText)
    expect(result.lastAgent).toBe('Updated the test suite to cover the login fix.')
  })

  test('returns empty object for empty text', () => {
    expect(parseCopilotEvents('')).toEqual({})
  })

  test('returns empty object for whitespace-only text', () => {
    expect(parseCopilotEvents('   \n  ')).toEqual({})
  })

  test('ignores non-message event types', () => {
    const text = JSON.stringify({ type: 'session.start', data: { sessionId: 'x' } }) + '\n'
    expect(parseCopilotEvents(text)).toEqual({})
  })

  test('truncates long messages', () => {
    const long = 'y'.repeat(200)
    const text = JSON.stringify({ type: 'user.message', data: { content: long } }) + '\n'
    const result = parseCopilotEvents(text)
    expect(result.lastUser!.length).toBeLessThanOrEqual(81)
    expect(result.lastUser!).toEndWith('…')
  })
})
