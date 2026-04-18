import { describe, test, expect } from 'bun:test'
import { buildResumeArgv, RESUME_COMMANDS } from '../src/launcher.ts'
import type { Session } from '../src/parsers/types.ts'

function makeSession(tool: Session['tool'], id: string, cwd = '/tmp'): Session {
  return {
    id,
    tool,
    cwd,
    updatedAt: Date.now(),
    filePath: '/tmp/fake',
    fileMtime: Date.now(),
  }
}

describe('buildResumeArgv', () => {
  test('claude: produces claude --resume <id>', () => {
    const argv = buildResumeArgv(makeSession('claude', 'abc-123'))
    expect(argv).toEqual(['claude', '--resume', 'abc-123'])
  })

  test('codex: produces codex resume <id>', () => {
    const argv = buildResumeArgv(makeSession('codex', 'xyz-456'))
    expect(argv).toEqual(['codex', 'resume', 'xyz-456'])
  })

  test('copilot: produces gh copilot -- --resume=<id>', () => {
    const argv = buildResumeArgv(makeSession('copilot', 'uuid-789'))
    expect(argv).toEqual(['gh', 'copilot', '--', '--resume=uuid-789'])
  })

  test('all tools have a command registered', () => {
    const tools: Session['tool'][] = ['claude', 'codex', 'copilot']
    for (const tool of tools) {
      expect(RESUME_COMMANDS[tool]).toBeDefined()
    }
  })

  test('throws on unknown tool', () => {
    const bad = makeSession('claude', 'id')
    bad.tool = 'unknown' as Session['tool']
    expect(() => buildResumeArgv(bad)).toThrow('Unknown tool')
  })
})
