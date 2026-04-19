import { type Session } from './types.ts'
import { truncateMessage } from '../format.ts'
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

export interface LastEntry {
  display: string
  timestamp: number
}

/** Pure: parse a single session metadata JSON file. */
export function parseClaudeSessionJson(raw: string): ClaudeSessionFile | null {
  try {
    const data: ClaudeSessionFile = JSON.parse(raw)
    if (!data.sessionId) return null
    return data
  } catch {
    return null
  }
}

/** Pure: parse history.jsonl text into a map of sessionId → latest entry. */
export function parseClaudeHistory(text: string): Map<string, LastEntry> {
  const history = new Map<string, LastEntry>()
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
  return history
}

/** Pure: join session metas with history to produce Session objects. */
export function joinClaudeSessionsWithHistory(
  metas: Array<ClaudeSessionFile & { filePath: string; fileMtime: number }>,
  history: Map<string, LastEntry>,
): Session[] {
  return metas.map((s) => {
    const last = history.get(s.sessionId)
    return {
      id: s.sessionId,
      tool: 'claude' as const,
      cwd: s.cwd,
      updatedAt: last?.timestamp ?? s.startedAt,
      lastUser: last?.display ? truncateMessage(last.display) : undefined,
      lastAgent: undefined, // Claude doesn't expose agent responses in history.jsonl
      filePath: s.filePath,
      fileMtime: s.fileMtime,
    }
  })
}

/** I/O wrapper: parse all Claude sessions using filesystem. */
export async function parseClaudeSessions(
  sessionsDir?: string,
  historyPath?: string,
): Promise<Session[]> {
  const home = process.env.HOME ?? ''
  const sDir = sessionsDir ?? join(home, '.claude', 'sessions')
  const hPath = historyPath ?? join(home, '.claude', 'history.jsonl')

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
        const data = parseClaudeSessionJson(raw)
        if (!data) return null
        const stat = await Bun.file(filePath).stat()
        return { ...data, filePath, fileMtime: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )

  const metas = metaResults.filter((s): s is NonNullable<typeof s> => s !== null)
  if (metas.length === 0) return []

  let historyText = ''
  try {
    historyText = await Bun.file(hPath).text()
  } catch {
    // history.jsonl may not exist yet
  }

  const history = parseClaudeHistory(historyText)
  return joinClaudeSessionsWithHistory(metas, history)
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
