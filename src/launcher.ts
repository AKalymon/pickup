import { type Session } from './parsers/types.ts'
import type { ProcessSpawner } from './ports.ts'
import type { Emulator } from './terminal.ts'

export const RESUME_COMMANDS: Record<string, (id: string) => string[]> = {
  claude:  (id) => ['claude', '--resume', id],
  codex:   (id) => ['codex',  'resume',   id],
  copilot: (id) => ['gh', 'copilot', '--', `--resume=${id}`],
}

export function buildResumeCommand(session: Session): string[] {
  const fn = RESUME_COMMANDS[session.tool]
  if (!fn) throw new Error(`Unknown tool: ${session.tool}`)
  return fn(session.id)
}

function determineWorkingDirectory(session: Session): string | undefined {
  // Claude scopes sessions to cwd — must launch from the session's original directory
  return session.tool === 'claude' ? session.cwd : undefined
}

export interface LaunchDeps {
  spawner: ProcessSpawner
  findEmulator(): Emulator | null
  exit(code: number): never
  logError(msg: string): void
}

/** Launch a single session in the current terminal (replaces the process). */
export function launchInCurrentTerminal(
  session: Session,
  spawner: ProcessSpawner,
  exit: (code: number) => never,
  logError: (msg: string) => void,
): never {
  const argv = buildResumeCommand(session)
  const [bin, ...args] = argv as [string, ...string[]]
  const cwd = determineWorkingDirectory(session)

  const result = spawner.spawnSync(bin, args, { stdio: 'inherit', cwd })

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      logError(`pickup: '${bin}' not found — is it installed and on your PATH?`)
    } else {
      logError(`pickup: failed to launch '${bin}': ${err.message}`)
    }
    return exit(1)
  }

  return exit(result.status ?? 0)
}

/** Launch multiple sessions, each in a new terminal window. */
export async function launchInNewWindows(
  sessions: Session[],
  emulator: Emulator,
  spawner: ProcessSpawner,
  logError: (msg: string) => void,
): Promise<{ failures: number }> {
  let failures = 0

  for (const session of sessions) {
    const resumeArgv = buildResumeCommand(session)
    const argv = emulator.buildTerminalCommand(resumeArgv)
    const [bin, ...args] = argv as [string, ...string[]]
    const cwd = determineWorkingDirectory(session)

    const child = spawner.spawnDetached(bin, args, { cwd })
    child.onError((err: NodeJS.ErrnoException) => {
      const msg = err.code === 'ENOENT'
        ? `pickup: '${bin}' not found`
        : `pickup: failed to open window for ${session.tool} (${session.id}): ${err.message}`
      logError(msg)
      failures++
    })
    child.unref()
  }

  // Give async spawn errors time to surface before returning
  await new Promise(r => setTimeout(r, 200))
  return { failures }
}

/** Entry point: single session → current terminal, multiple → new windows. */
export async function launchSessions(sessions: Session[], deps: LaunchDeps): Promise<void> {
  if (sessions.length === 1) {
    launchInCurrentTerminal(sessions[0]!, deps.spawner, deps.exit, deps.logError)
  } else {
    const emulator = deps.findEmulator()
    if (!emulator) {
      deps.logError(
        'pickup: could not detect a supported terminal emulator.\n' +
        'Supported: kitty, alacritty, wezterm, gnome-terminal, xterm'
      )
      deps.exit(1)
    }
    const { failures } = await launchInNewWindows(sessions, emulator!, deps.spawner, deps.logError)
    deps.exit(failures > 0 ? 1 : 0)
  }
}
