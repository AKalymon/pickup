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
  isSelected: boolean
  maxWidth: number
}

function SessionRow({ session, isSelected, maxWidth }: SessionRowProps) {
  const color = TOOL_COLOR[session.tool] ?? 'white'
  const path = truncateToWidth(shortenPath(session.cwd), maxWidth - 20)
  const time = relativeTime(session.updatedAt)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Line 1: tool + time */}
      <Box>
        <Text color={isSelected ? 'green' : undefined} bold={isSelected}>
          {isSelected ? '▶ ' : '  '}
        </Text>
        <Text color={color} bold={isSelected}>{session.tool}</Text>
        <Text dimColor>  {time}</Text>
      </Box>
      {/* Line 2: directory */}
      <Box>
        <Text>{'   '}</Text>
        <Text dimColor>dir: </Text>
        <Text bold={isSelected}>{path}</Text>
      </Box>
      {/* Line 3: last user message */}
      <Box>
        <Text>{'   '}</Text>
        <Text dimColor>you: </Text>
        {session.lastUser
          ? <Text>{session.lastUser}</Text>
          : <Text dimColor>—</Text>}
      </Box>
      {/* Line 4: last agent message */}
      <Box>
        <Text>{'   '}</Text>
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
  onSelect: (session: Session) => void
  onExit: () => void
}

function Picker({ sessions, onSelect, onExit }: PickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const { stdout } = useStdout()
  const { exit } = useApp()

  const termHeight = stdout?.rows ?? 24
  const termWidth  = stdout?.columns ?? 80

  // Available lines: total minus title (1) + title margin (1) + footer margin (1) + footer (1)
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
      const next = Math.max(0, selectedIndex - 1)
      setSelectedIndex(next)
      if (next < scrollOffset) setScrollOffset(next)
    }

    if (key.downArrow || input === 'j') {
      const next = Math.min(sessions.length - 1, selectedIndex + 1)
      setSelectedIndex(next)
      if (next >= scrollOffset + visibleCount) {
        setScrollOffset(next - visibleCount + 1)
      }
    }

    if (key.return) {
      const session = sessions[selectedIndex]
      if (session) {
        exit()
        onSelect(session)
      }
    }
  })

  const visibleSessions = sessions.slice(scrollOffset, scrollOffset + visibleCount)
  const aboveCount = scrollOffset
  const belowCount = Math.max(0, sessions.length - scrollOffset - visibleCount)

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>pickup</Text>
        <Text dimColor> — select a session to resume</Text>
      </Box>

      {/* Scroll indicator: above */}
      {aboveCount > 0 && (
        <Text dimColor>  ↑ {aboveCount} more above</Text>
      )}

      {/* Session list */}
      {visibleSessions.map((session, i) => (
        <SessionRow
          key={session.id}
          session={session}
          isSelected={scrollOffset + i === selectedIndex}
          maxWidth={maxWidth}
        />
      ))}

      {/* Scroll indicator: below */}
      {belowCount > 0 && (
        <Text dimColor>  ↓ {belowCount} more below</Text>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>↑↓ / jk  navigate    enter  resume    q  quit</Text>
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

export async function runPicker(sessions: Session[]): Promise<Session | null> {
  if (sessions.length === 0) {
    const { waitUntilExit, unmount } = render(<EmptyState />)
    await new Promise(r => setTimeout(r, 2000))
    unmount()
    await waitUntilExit().catch(() => {})
    return null
  }

  let selected: Session | null = null

  const { waitUntilExit } = render(
    <Picker
      sessions={sessions}
      onSelect={(s) => { selected = s }}
      onExit={() => {}}
    />,
  )

  await waitUntilExit().catch(() => {})
  return selected
}
