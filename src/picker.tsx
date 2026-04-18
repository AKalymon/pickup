import React, { useState } from 'react'
import { render, Box, Text, useInput, useApp, useStdout } from 'ink'
import { type Session } from './parsers/types.ts'

const TOOL_COLOR: Record<string, string> = {
  claude:  'yellow',
  codex:   'cyan',
  copilot: 'magenta',
}

// Lines rendered per session row (header + dir + 2 message lines + 1 gap)
const ROW_LINES = 5

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? ''
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

function truncateToWidth(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

interface SessionRowProps {
  session: Session
  isFocused: boolean
  isChecked: boolean
  maxWidth: number
}

function SessionRow({ session, isFocused, isChecked, maxWidth }: SessionRowProps) {
  const color = TOOL_COLOR[session.tool] ?? 'white'
  const path = truncateToWidth(shortenPath(session.cwd), maxWidth - 20)
  const time = relativeTime(session.updatedAt)

  const checkbox = isChecked ? '[✓]' : '[ ]'

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Line 1: cursor + checkbox + tool + time */}
      <Box>
        <Text color={isFocused ? 'green' : undefined} bold={isFocused}>
          {isFocused ? '▶ ' : '  '}
        </Text>
        <Text color={isChecked ? 'green' : 'gray'}>{checkbox} </Text>
        <Text color={color} bold={isFocused}>{session.tool}</Text>
        <Text dimColor>  {time}</Text>
      </Box>
      {/* Line 2: directory */}
      <Box>
        <Text>{'       '}</Text>
        <Text dimColor>dir: </Text>
        <Text bold={isFocused}>{path}</Text>
      </Box>
      {/* Line 3: last user message */}
      <Box>
        <Text>{'       '}</Text>
        <Text dimColor>you: </Text>
        {session.lastUser
          ? <Text>{session.lastUser}</Text>
          : <Text dimColor>—</Text>}
      </Box>
      {/* Line 4: last agent message */}
      <Box>
        <Text>{'       '}</Text>
        <Text dimColor>ai:  </Text>
        {session.lastAgent
          ? <Text dimColor>{session.lastAgent}</Text>
          : <Text dimColor>—</Text>}
      </Box>
    </Box>
  )
}

interface PickerProps {
  sessions: Session[]
  onConfirm: (sessions: Session[]) => void
  onExit: () => void
}

function Picker({ sessions, onConfirm, onExit }: PickerProps) {
  const [focusIndex, setFocusIndex]   = useState(0)
  const [checked, setChecked]         = useState<Set<string>>(new Set())
  const [scrollOffset, setScrollOffset] = useState(0)
  const { stdout } = useStdout()
  const { exit } = useApp()

  const termHeight = stdout?.rows ?? 24
  const termWidth  = stdout?.columns ?? 80
  const availableLines = termHeight - 4
  const visibleCount = Math.max(1, Math.floor(availableLines / ROW_LINES))
  const maxWidth = termWidth

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit()
      onExit()
      return
    }

    if (key.upArrow || input === 'k') {
      const next = Math.max(0, focusIndex - 1)
      setFocusIndex(next)
      if (next < scrollOffset) setScrollOffset(next)
    }

    if (key.downArrow || input === 'j') {
      const next = Math.min(sessions.length - 1, focusIndex + 1)
      setFocusIndex(next)
      if (next >= scrollOffset + visibleCount) {
        setScrollOffset(next - visibleCount + 1)
      }
    }

    if (input === ' ') {
      const session = sessions[focusIndex]
      if (!session) return
      setChecked(prev => {
        const next = new Set(prev)
        if (next.has(session.id)) next.delete(session.id)
        else next.add(session.id)
        return next
      })
    }

    if (key.return) {
      // If nothing checked, resume the focused session
      // If sessions are checked, resume all checked ones
      if (checked.size === 0) {
        const session = sessions[focusIndex]
        if (session) { exit(); onConfirm([session]) }
      } else {
        const toResume = sessions.filter(s => checked.has(s.id))
        exit()
        onConfirm(toResume)
      }
    }
  })

  const visibleSessions = sessions.slice(scrollOffset, scrollOffset + visibleCount)
  const aboveCount = scrollOffset
  const belowCount = Math.max(0, sessions.length - scrollOffset - visibleCount)
  const checkedCount = checked.size

  const footerHint = checkedCount > 0
    ? `${checkedCount} selected — enter to resume all in new windows`
    : 'enter resume  space select  ↑↓/jk navigate  q quit'

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>pickup</Text>
        <Text dimColor> — select a session to resume</Text>
      </Box>

      {aboveCount > 0 && <Text dimColor>  ↑ {aboveCount} more above</Text>}

      {visibleSessions.map((session, i) => (
        <SessionRow
          key={session.id}
          session={session}
          isFocused={scrollOffset + i === focusIndex}
          isChecked={checked.has(session.id)}
          maxWidth={maxWidth}
        />
      ))}

      {belowCount > 0 && <Text dimColor>  ↓ {belowCount} more below</Text>}

      <Box marginTop={1}>
        <Text dimColor>{footerHint}</Text>
      </Box>
    </Box>
  )
}

function EmptyState() {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>pickup</Text>
      <Text>No sessions found.</Text>
      <Text dimColor>Try running with --refresh to re-index, or check that your AI tools have session history.</Text>
    </Box>
  )
}

export async function runPicker(sessions: Session[]): Promise<Session[]> {
  if (sessions.length === 0) {
    const { waitUntilExit, unmount } = render(<EmptyState />)
    await new Promise(r => setTimeout(r, 2000))
    unmount()
    await waitUntilExit().catch(() => {})
    return []
  }

  let selected: Session[] = []

  const { waitUntilExit } = render(
    <Picker
      sessions={sessions}
      onConfirm={(s) => { selected = s }}
      onExit={() => {}}
    />,
  )

  await waitUntilExit().catch(() => {})
  return selected
}
