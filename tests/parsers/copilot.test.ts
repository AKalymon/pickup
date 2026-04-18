import { describe, test, expect, beforeAll } from 'bun:test'
import { parseCopilotWorkspace, parseCopilotSessions } from '../../src/parsers/copilot.ts'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const fixtures = join(import.meta.dir, '../fixtures')
const copilotSessionFixture = join(fixtures, 'copilot-session')
const workspaceFixture = join(copilotSessionFixture, 'workspace.yaml')

describe('parseCopilotWorkspace', () => {
  test('parses id and cwd correctly', async () => {
    const session = await parseCopilotWorkspace(workspaceFixture)
    expect(session).not.toBeNull()
    expect(session!.id).toBe('222b9523-4475-473b-b0ba-25943ef45429')
    expect(session!.cwd).toBe('/home/user/myproject')
    expect(session!.tool).toBe('copilot')
  })

  test('uses updated_at as updatedAt', async () => {
    const session = await parseCopilotWorkspace(workspaceFixture)
    expect(session!.updatedAt).toBe(new Date('2026-04-11T00:28:54.548Z').getTime())
  })

  test('reads last user message from events.jsonl', async () => {
    const session = await parseCopilotWorkspace(workspaceFixture)
    expect(session!.lastUser).toBe('also update the tests')
  })

  test('reads last agent message from events.jsonl', async () => {
    const session = await parseCopilotWorkspace(workspaceFixture)
    expect(session!.lastAgent).toBe('Updated the test suite to cover the login fix.')
  })

  test('returns null on missing file', async () => {
    const session = await parseCopilotWorkspace('/tmp/does-not-exist.yaml')
    expect(session).toBeNull()
  })

  test('returns null on malformed YAML', async () => {
    const tmpPath = '/tmp/pickup-bad.yaml'
    await Bun.write(tmpPath, '{{{{ not yaml')
    const session = await parseCopilotWorkspace(tmpPath)
    expect(session).toBeNull()
  })

  test('fileMtime is a positive number', async () => {
    const session = await parseCopilotWorkspace(workspaceFixture)
    expect(session!.fileMtime).toBeGreaterThan(0)
  })

  test('lastUser and lastAgent are undefined when no events.jsonl', async () => {
    const dir = join(tmpdir(), `pickup-copilot-noevents-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    await Bun.write(
      join(dir, 'workspace.yaml'),
      await Bun.file(workspaceFixture).text(),
    )
    const session = await parseCopilotWorkspace(join(dir, 'workspace.yaml'))
    expect(session!.lastUser).toBeUndefined()
    expect(session!.lastAgent).toBeUndefined()
  })
})

describe('parseCopilotSessions', () => {
  let sessionsDir: string

  beforeAll(() => {
    // Create a fake session-state dir with one session folder
    sessionsDir = join(tmpdir(), `pickup-test-copilot-${Date.now()}`)
    const sessionDir = join(sessionsDir, '222b9523-4475-473b-b0ba-25943ef45429')
    mkdirSync(sessionDir, { recursive: true })
    Bun.write(join(sessionDir, 'workspace.yaml'), Bun.file(workspaceFixture))
    Bun.write(
      join(sessionDir, 'events.jsonl'),
      Bun.file(join(copilotSessionFixture, 'events.jsonl')),
    )
  })

  test('collects all workspace.yaml files from subdirs', async () => {
    await new Promise(r => setTimeout(r, 50))
    const sessions = await parseCopilotSessions(sessionsDir)
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    expect(sessions[0]!.tool).toBe('copilot')
  })

  test('sessions include messages from events.jsonl', async () => {
    await new Promise(r => setTimeout(r, 50))
    const sessions = await parseCopilotSessions(sessionsDir)
    const s = sessions[0]!
    expect(s.lastUser).toBe('also update the tests')
    expect(s.lastAgent).toBe('Updated the test suite to cover the login fix.')
  })

  test('returns empty array when dir does not exist', async () => {
    const sessions = await parseCopilotSessions('/tmp/does-not-exist-copilot-dir')
    expect(sessions).toHaveLength(0)
  })
})
