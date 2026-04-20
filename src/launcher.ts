import { type Session } from './parsers/types.ts'
import type { ProcessSpawner } from './ports.ts'
import type { Emulator } from './terminal.ts'

export interface LaunchDeps {
  spawner: ProcessSpawner
  findEmulator(): Emulator | null
  exit(code: number): never
  logError(msg: string): void
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/** Single session → current terminal. Multiple sessions → new windows each. */
export async function launchSessions(sessions: Session[], deps: LaunchDeps): Promise<void> {
  if (sessions.length === 1) {
    launchInCurrentTerminal(sessions[0]!, deps.spawner, deps.exit, deps.logError)
  } else {
    await launchInNewTerminalWindows(sessions, deps)
  }
}

// ─── Launch strategies ────────────────────────────────────────────────────────

/** Replace the current process with the resumed session. */
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
    logError(describeSpawnError(bin, result.error as NodeJS.ErrnoException))
    return exit(1)
  }

  return exit(result.status ?? 0)
}

/** Open each session in its own new terminal window. */
export async function launchInNewWindows(
  sessions: Session[],
  emulator: Emulator,
  spawner: ProcessSpawner,
  logError: (msg: string) => void,
): Promise<{ failures: number }> {
  let failures = 0

  for (const session of sessions) {
    const argv = emulator.buildTerminalCommand(buildResumeCommand(session))
    const [bin, ...args] = argv as [string, ...string[]]
    const child = spawner.spawnDetached(bin, args, { cwd: determineWorkingDirectory(session) })
    child.onError((err: NodeJS.ErrnoException) => {
      logError(describeSpawnError(bin, err, session))
      failures++
    })
    child.unref()
  }

  await new Promise(r => setTimeout(r, 200))
  return { failures }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function launchInNewTerminalWindows(sessions: Session[], deps: LaunchDeps): Promise<void> {
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

export function buildResumeCommand(session: Session): string[] {
  const fn = RESUME_COMMANDS[session.tool]
  if (!fn) throw new Error(`Unknown tool: ${session.tool}`)
  return fn(session.id)
}

function determineWorkingDirectory(session: Session): string | undefined {
  // Claude scopes sessions to cwd — must launch from the session's original directory
  return session.tool === 'claude' ? session.cwd : undefined
}

function describeSpawnError(
  bin: string,
  err: NodeJS.ErrnoException,
  session?: Session,
): string {
  if (err.code === 'ENOENT') return `pickup: '${bin}' not found`
  const context = session ? ` for ${session.tool} (${session.id})` : ''
  return `pickup: failed to launch '${bin}'${context}: ${err.message}`
}

export const RESUME_COMMANDS: Record<string, (id: string) => string[]> = {
  claude:  (id) => ['claude', '--resume', id],
  codex:   (id) => ['codex',  'resume',   id],
  copilot: (id) => ['gh', 'copilot', '--', `--resume=${id}`],
}
