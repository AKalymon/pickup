import { type Session } from './parsers/types.ts'
import { spawnSync, spawn } from 'node:child_process'
import { detectEmulator } from './terminal.ts'

export const RESUME_COMMANDS: Record<string, (id: string) => string[]> = {
  claude:  (id) => ['claude', '--resume', id],
  codex:   (id) => ['codex',  'resume',   id],
  copilot: (id) => ['gh', 'copilot', '--', `--resume=${id}`],
}

export function buildResumeArgv(session: Session): string[] {
  const fn = RESUME_COMMANDS[session.tool]
  if (!fn) throw new Error(`Unknown tool: ${session.tool}`)
  return fn(session.id)
}

function cwdFor(session: Session): string | undefined {
  // Claude scopes sessions to cwd — must launch from the session's original directory
  return session.tool === 'claude' ? session.cwd : undefined
}

/** Launch a single session in the current terminal (replaces the process). */
export function launchSingle(session: Session): never {
  const argv = buildResumeArgv(session)
  const [bin, ...args] = argv as [string, ...string[]]
  const cwd = cwdFor(session)

  const result = spawnSync(bin, args, { stdio: 'inherit', cwd })

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      console.error(`pickup: '${bin}' not found — is it installed and on your PATH?`)
    } else {
      console.error(`pickup: failed to launch '${bin}': ${err.message}`)
    }
    process.exit(1)
  }

  process.exit(result.status ?? 0)
}

/** Launch multiple sessions, each in a new terminal window. */
function launchMultiple(sessions: Session[]): void {
  const emulator = detectEmulator()

  if (!emulator) {
    console.error(
      'pickup: could not detect a supported terminal emulator.\n' +
      'Supported: kitty, alacritty, wezterm, gnome-terminal, xterm'
    )
    process.exit(1)
  }

  let failures = 0

  for (const session of sessions) {
    const resumeArgv = buildResumeArgv(session)
    const argv = emulator.buildArgv(resumeArgv)
    const [bin, ...args] = argv as [string, ...string[]]
    const cwd = cwdFor(session)

    const child = spawn(bin, args, {
      stdio: 'ignore',
      detached: true,
      cwd,
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      const msg = err.code === 'ENOENT'
        ? `pickup: '${bin}' not found`
        : `pickup: failed to open window for ${session.tool} (${session.id}): ${err.message}`
      console.error(msg)
      failures++
    })

    child.unref()
  }

  // Small delay to let spawn errors surface before exiting
  setTimeout(() => process.exit(failures > 0 ? 1 : 0), 200)
}

/** Entry point: single session → current terminal, multiple → new windows. */
export function launch(sessions: Session[]): void {
  if (sessions.length === 1) {
    launchSingle(sessions[0]!)
  } else {
    launchMultiple(sessions)
  }
}
