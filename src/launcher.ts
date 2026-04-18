import { type Session } from './parsers/types.ts'
import { spawnSync } from 'node:child_process'

// Maps tool name to the argv needed to resume a session by ID.
// Update copilot command once the exact flag is confirmed.
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

export function launch(session: Session): never {
  const argv = buildResumeArgv(session)
  const [bin, ...args] = argv as [string, ...string[]]

  // Claude scopes sessions to cwd — must launch from the session's original directory
  const cwd = session.tool === 'claude' ? session.cwd : undefined

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
