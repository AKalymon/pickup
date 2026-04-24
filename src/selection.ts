import { type Session } from './parsers/types.ts'
import type { LaunchMode } from './launcher.ts'

export interface LaunchSelection {
  sessions: Session[]
  mode: LaunchMode
}

export function resolveLaunchSelection(
  sessions: Session[],
  focusIndex: number,
  checked: Set<string>,
): LaunchSelection | null {
  if (checked.size === 0) {
    const session = sessions[focusIndex]
    return session ? { sessions: [session], mode: 'current-terminal' } : null
  }

  const selected = sessions.filter((session) => checked.has(session.id))
  return selected.length > 0
    ? { sessions: selected, mode: 'separate-terminal-sessions' }
    : null
}
