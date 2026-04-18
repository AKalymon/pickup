import { type Session, truncate } from './types.ts'
import { join } from 'node:path'

interface ClaudeSessionFile {
  sessionId: string
  cwd: string
  startedAt: number  // unix ms
  pid?: number
  kind?: string
}

interface HistoryEntry {
  sessionId: string
  display: string
  timestamp: number
}

interface LastEntry {
  display: string
  timestamp: number
}

export async function parseClaudeSessions(
  sessionsDir?: string,
  historyPath?: string,
): Promise<Session[]> {
  const home = process.env.HOME ?? ''
  const sDir = sessionsDir ?? join(home, '.claude', 'sessions')
  const hPath = historyPath ?? join(home, '.claude', 'history.jsonl')

  // --- Parse session metadata files (tiny JSON, parse all in parallel) ---
  const glob = new Bun.Glob('*.json')
  const sessionFiles: string[] = []
  for await (const f of glob.scan({ cwd: sDir, onlyFiles: true })) {
    sessionFiles.push(join(sDir, f))
  }

  if (sessionFiles.length === 0) return []

  const metaResults = await Promise.all(
    sessionFiles.map(async (filePath) => {
      try {
        const raw = await Bun.file(filePath).text()
        const data: ClaudeSessionFile = JSON.parse(raw)
        if (!data.sessionId) return null
        const stat = await Bun.file(filePath).stat()
        return { ...data, filePath, fileMtime: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )

  const sessions = metaResults.filter((s): s is NonNullable<typeof s> => s !== null)
  if (sessions.length === 0) return []

  // --- Scan history.jsonl once — build Map<sessionId, latestEntry> ---
  const history = new Map<string, LastEntry>()
  try {
    const text = await Bun.file(hPath).text()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry: HistoryEntry = JSON.parse(line)
        if (!entry.sessionId || !entry.display) continue
        const existing = history.get(entry.sessionId)
        if (!existing || entry.timestamp > existing.timestamp) {
          history.set(entry.sessionId, { display: entry.display, timestamp: entry.timestamp })
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // history.jsonl may not exist yet
  }

  // --- Join ---
  return sessions.map((s) => {
    const last = history.get(s.sessionId)
    return {
      id: s.sessionId,
      tool: 'claude' as const,
      cwd: s.cwd,
      updatedAt: last?.timestamp ?? s.startedAt,
      lastUser: last?.display ? truncate(last.display) : undefined,
      lastAgent: undefined, // Claude doesn't expose agent responses in history.jsonl
      filePath: s.filePath,
      fileMtime: s.fileMtime,
    }
  })
}

export async function collectClaudeFiles(sessionsDir?: string): Promise<string[]> {
  const base = sessionsDir ?? join(process.env.HOME ?? '', '.claude', 'sessions')
  const glob = new Bun.Glob('*.json')
  const files: string[] = []
  try {
    for await (const f of glob.scan({ cwd: base, onlyFiles: true })) {
      files.push(join(base, f))
    }
  } catch {
    // dir doesn't exist or isn't readable
  }
  return files
}
