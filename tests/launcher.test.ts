import { describe, test, expect } from 'bun:test'
import {
  buildResumeCommand,
  launchInCurrentTerminal,
  launchInNewWindows,
  launchSessions,
  RESUME_COMMANDS,
} from '../src/launcher.ts'
import type { Session } from '../src/parsers/types.ts'
import type { ProcessSpawner, DetachedProcess } from '../src/ports.ts'
import type { Emulator } from '../src/terminal.ts'

function makeSession(tool: Session['tool'], id: string, cwd = '/tmp'): Session {
  return { id, tool, cwd, updatedAt: Date.now(), filePath: '/tmp/fake', fileMtime: Date.now() }
}

function makeSyncSpawner(status = 0, error?: NodeJS.ErrnoException): ProcessSpawner {
  return {
    spawnSync: () => ({ status, error }),
    spawnDetached: () => ({ onError: () => {}, unref: () => {} }),
  }
}

function makeDetachedSpawner(onLaunch?: (bin: string, args: string[]) => void): ProcessSpawner {
  return {
    spawnSync: () => ({ status: 0 }),
    spawnDetached: (bin, args) => {
      onLaunch?.(bin, args)
      return { onError: () => {}, unref: () => {} }
    },
  }
}

function makeErrorDetachedSpawner(errCode: string): ProcessSpawner {
  return {
    spawnSync: () => ({ status: 0 }),
    spawnDetached: () => {
      let cb: ((err: NodeJS.ErrnoException) => void) | undefined
      // Simulate async error by scheduling synchronously (tests don't care about timing)
      const proc: DetachedProcess = {
        onError: (fn) => { cb = fn },
        unref: () => { cb?.({ code: errCode } as NodeJS.ErrnoException) },
      }
      return proc
    },
  }
}

function makeEmulator(name = 'xterm', onBuild?: (cmd: string[], cwd?: string) => void): Emulator {
  return {
    name,
    buildTerminalCommand: (cmd, cwd) => {
      onBuild?.(cmd, cwd)
      return [name, '-e', ...cmd]
    },
  }
}

describe('buildResumeCommand', () => {
  test('claude: produces claude --resume <id>', () => {
    expect(buildResumeCommand(makeSession('claude', 'abc-123'))).toEqual(['claude', '--resume', 'abc-123'])
  })

  test('codex: produces codex resume <id>', () => {
    expect(buildResumeCommand(makeSession('codex', 'xyz-456'))).toEqual(['codex', 'resume', 'xyz-456'])
  })

  test('copilot: produces gh copilot -- --resume=<id>', () => {
    expect(buildResumeCommand(makeSession('copilot', 'uuid-789'))).toEqual(['gh', 'copilot', '--', '--resume=uuid-789'])
  })

  test('all tools have a command registered', () => {
    for (const tool of ['claude', 'codex', 'copilot'] as Session['tool'][]) {
      expect(RESUME_COMMANDS[tool]).toBeDefined()
    }
  })

  test('throws on unknown tool', () => {
    const bad = makeSession('claude', 'id')
    bad.tool = 'unknown' as Session['tool']
    expect(() => buildResumeCommand(bad)).toThrow('Unknown tool')
  })
})

describe('launchInCurrentTerminal', () => {
  test('calls spawnSync with the resume command', () => {
    const calls: Array<{ bin: string; args: string[] }> = []
    const spawner: ProcessSpawner = {
      spawnSync: (bin, args) => { calls.push({ bin, args }); return { status: 0 } },
      spawnDetached: () => ({ onError: () => {}, unref: () => {} }),
    }
    const exit = (_code: number): never => { throw new Error('exit') }
    try {
      launchInCurrentTerminal(makeSession('codex', 'sess-1'), spawner, exit, () => {})
    } catch {}
    expect(calls[0]?.bin).toBe('codex')
    expect(calls[0]?.args).toEqual(['resume', 'sess-1'])
  })

  test('passes claude cwd to spawner', () => {
    const calls: Array<{ opts: any }> = []
    const spawner: ProcessSpawner = {
      spawnSync: (bin, args, opts) => { calls.push({ opts }); return { status: 0 } },
      spawnDetached: () => ({ onError: () => {}, unref: () => {} }),
    }
    const exit = (_code: number): never => { throw new Error('exit') }
    try {
      launchInCurrentTerminal(makeSession('claude', 'sess-2', '/my/proj'), spawner, exit, () => {})
    } catch {}
    expect(calls[0]?.opts?.cwd).toBe('/my/proj')
  })

  test('codex cwd is undefined', () => {
    const calls: Array<{ opts: any }> = []
    const spawner: ProcessSpawner = {
      spawnSync: (bin, args, opts) => { calls.push({ opts }); return { status: 0 } },
      spawnDetached: () => ({ onError: () => {}, unref: () => {} }),
    }
    const exit = (_code: number): never => { throw new Error('exit') }
    try {
      launchInCurrentTerminal(makeSession('codex', 'sess-3', '/my/proj'), spawner, exit, () => {})
    } catch {}
    expect(calls[0]?.opts?.cwd).toBeUndefined()
  })

  test('calls exit with spawn status', () => {
    let exitCode: number | undefined
    const exit = (code: number): never => { exitCode = code; throw new Error('exit') }
    try {
      launchInCurrentTerminal(makeSession('codex', 'x'), makeSyncSpawner(42), exit, () => {})
    } catch {}
    expect(exitCode).toBe(42)
  })

  test('logs ENOENT error and exits 1', () => {
    const errors: string[] = []
    let exitCode: number | undefined
    const exit = (code: number): never => { exitCode = code; throw new Error('exit') }
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' }) as NodeJS.ErrnoException
    try {
      launchInCurrentTerminal(makeSession('codex', 'x'), makeSyncSpawner(0, err), exit, (m) => errors.push(m))
    } catch {}
    expect(exitCode).toBe(1)
    expect(errors[0]).toMatch(/not found/)
  })
})

describe('launchInNewWindows', () => {
  test('spawns one detached process per session', async () => {
    const launched: string[] = []
    const spawner = makeDetachedSpawner((bin) => launched.push(bin))
    await launchInNewWindows(
      [makeSession('codex', 'a'), makeSession('copilot', 'b')],
      makeEmulator('xterm'),
      spawner,
      () => {},
    )
    expect(launched).toHaveLength(2)
    expect(launched.every(b => b === 'xterm')).toBe(true)
  }, 1000)

  test('returns failures count for ENOENT errors', async () => {
    const errors: string[] = []
    const { failures } = await launchInNewWindows(
      [makeSession('codex', 'a'), makeSession('claude', 'b', '/p')],
      makeEmulator('xterm'),
      makeErrorDetachedSpawner('ENOENT'),
      (m) => errors.push(m),
    )
    expect(failures).toBe(2)
  }, 1000)

  test('returns 0 failures on success', async () => {
    const { failures } = await launchInNewWindows(
      [makeSession('codex', 'a')],
      makeEmulator('xterm'),
      makeDetachedSpawner(),
      () => {},
    )
    expect(failures).toBe(0)
  }, 1000)

  test('passes claude cwd to emulator command builder', async () => {
    const builds: Array<{ cmd: string[]; cwd?: string }> = []
    await launchInNewWindows(
      [makeSession('claude', 'a', '/claude/project')],
      makeEmulator('Terminal.app', (cmd, cwd) => builds.push({ cmd, cwd })),
      makeDetachedSpawner(),
      () => {},
    )
    expect(builds).toEqual([
      { cmd: ['claude', '--resume', 'a'], cwd: '/claude/project' },
    ])
  }, 1000)
})

describe('launchSessions', () => {
  test('routes single session to launchInCurrentTerminal', async () => {
    let exitCode: number | undefined
    const deps = {
      spawner: makeSyncSpawner(0),
      findEmulator: () => makeEmulator(),
      exit: (code: number): never => { exitCode = code; throw new Error('exit') },
      logError: () => {},
    }
    try {
      await launchSessions([makeSession('codex', 'single')], deps)
    } catch {}
    expect(exitCode).toBe(0)
  })

  test('respects separate-terminal-sessions mode for one checked session', async () => {
    const launched: string[] = []
    let exitCode: number | undefined
    const deps = {
      spawner: makeDetachedSpawner((bin) => launched.push(bin)),
      findEmulator: () => makeEmulator('Terminal.app'),
      exit: (code: number): never => { exitCode = code; throw new Error('exit') },
      logError: () => {},
    }
    try {
      await launchSessions([makeSession('codex', 'checked')], deps, 'separate-terminal-sessions')
    } catch {}
    expect(launched).toEqual(['Terminal.app'])
    expect(exitCode).toBe(0)
  })

  test('exits 1 when no emulator found for multiple sessions', async () => {
    let exitCode: number | undefined
    const errors: string[] = []
    const deps = {
      spawner: makeDetachedSpawner(),
      findEmulator: () => null,
      exit: (code: number): never => { exitCode = code; throw new Error('exit') },
      logError: (msg: string) => { errors.push(msg) },
    }
    try {
      await launchSessions([makeSession('codex', 'a'), makeSession('codex', 'b')], deps, 'separate-terminal-sessions')
    } catch {}
    expect(exitCode).toBe(1)
    expect(errors[0]).toMatch(/Ghostty, Terminal\.app, iTerm/)
  })
})
