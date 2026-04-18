import { type Database } from 'bun:sqlite'
import { getMtimeMap, upsertMany, removeStale, getTrackedMtime, setTrackedMtime } from './db.ts'
import { type Session } from './parsers/types.ts'
import { parseCodexSession, collectCodexFiles } from './parsers/codex.ts'
import { parseClaudeSessions, collectClaudeFiles } from './parsers/claude.ts'
import { parseCopilotWorkspace, collectCopilotFiles } from './parsers/copilot.ts'
import { join } from 'node:path'

export interface SyncOptions {
  /** Max sessions needed for the current query — limits how many new files we parse */
  limit?: number
  /** If set, only process sessions from this tool */
  tool?: 'claude' | 'copilot' | 'codex'
  /** Force re-parse of all files regardless of mtime */
  refresh?: boolean
  /** Custom home dir for testing */
  homeDir?: string
}

export interface FileRef {
  path: string
  tool: 'claude' | 'copilot' | 'codex'
  mtime: number
}

/** Collect and stat all session files across all enabled tools */
export async function collectAndStat(opts: SyncOptions = {}): Promise<FileRef[]> {
  const home = opts.homeDir ?? process.env.HOME ?? ''
  const { tool } = opts

  const collectors: Promise<string[]>[] = []

  if (!tool || tool === 'codex') {
    collectors.push(collectCodexFiles(join(home, '.codex', 'sessions')))
  }
  if (!tool || tool === 'claude') {
    collectors.push(collectClaudeFiles(join(home, '.claude', 'sessions')))
  }
  if (!tool || tool === 'copilot') {
    collectors.push(collectCopilotFiles(join(home, '.copilot', 'session-state')))
  }

  const [codexFiles = [], claudeFiles = [], copilotFiles = []] = await Promise.all(collectors)

  // Assign tools to files
  const tagged: Array<{ path: string; tool: 'claude' | 'copilot' | 'codex' }> = [
    ...codexFiles.map(p => ({ path: p, tool: 'codex' as const })),
    ...claudeFiles.map(p => ({ path: p, tool: 'claude' as const })),
    ...copilotFiles.map(p => ({ path: p, tool: 'copilot' as const })),
  ]

  // Stat all files in parallel
  const withMtime = await Promise.all(
    tagged.map(async f => {
      try {
        const stat = await Bun.file(f.path).stat()
        return { ...f, mtime: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )

  return withMtime.filter((f): f is FileRef => f !== null)
}

/** Parse a single file ref into a Session (dispatches by tool) */
async function parseFileRef(ref: FileRef, opts: SyncOptions): Promise<Session | null> {
  if (ref.tool === 'codex') {
    return parseCodexSession(ref.path)
  }

  if (ref.tool === 'copilot') {
    return parseCopilotWorkspace(ref.path)
  }

  // Claude: session files are tiny, but we need history.jsonl too.
  // We handle Claude as a batch in syncClaude() and skip individual file parsing here.
  return null
}

/** Sync Claude sessions as a batch (requires history.jsonl join) */
async function syncClaude(
  db: Database,
  allFiles: FileRef[],
  cachedMtimes: Map<string, number>,
  opts: SyncOptions,
): Promise<void> {
  const home = opts.homeDir ?? process.env.HOME ?? ''
  const claudeFiles = allFiles.filter(f => f.tool === 'claude')
  if (claudeFiles.length === 0) return

  const historyPath = join(home, '.claude', 'history.jsonl')

  // Check history.jsonl mtime — it updates with every message, independently of session files
  let historyMtime = 0
  try {
    historyMtime = (await Bun.file(historyPath).stat()).mtimeMs
  } catch { /* history.jsonl may not exist yet */ }

  const sessionFilesStale = claudeFiles.some(f => cachedMtimes.get(f.path) !== f.mtime)
  const historyStale = historyMtime !== getTrackedMtime(db, historyPath)
  const hasStale = opts.refresh || sessionFilesStale || historyStale

  if (!hasStale) return

  // Parse all Claude sessions as a batch (history.jsonl join is shared)
  const sessions = await parseClaudeSessions(
    join(home, '.claude', 'sessions'),
    historyPath,
  )

  // Attach correct mtimes from our stat results
  const mtimeByPath = new Map(claudeFiles.map(f => [f.path, f.mtime]))
  const withMtimes = sessions.map(s => ({
    ...s,
    fileMtime: mtimeByPath.get(s.filePath) ?? s.fileMtime,
  }))

  upsertMany(db, withMtimes)

  // Persist history.jsonl mtime so next run knows if it changed
  setTrackedMtime(db, historyPath, historyMtime)
}

/**
 * Main sync function.
 *
 * Strategy:
 * 1. Collect + stat all session files (cheap — syscalls only)
 * 2. Diff against DB mtimes — find stale/new files
 * 3. Sort stale files by mtime DESC — parse newest first
 * 4. Parse only as many as needed (up to Math.max(limit, 50) for the fast path)
 *    OR all of them if --refresh
 * 5. Upsert results into SQLite
 * 6. Remove DB entries for files that no longer exist on disk
 */
export async function sync(db: Database, opts: SyncOptions = {}): Promise<void> {
  const { limit = 10, refresh = false } = opts

  const allFiles = await collectAndStat(opts)
  const allPaths = new Set(allFiles.map(f => f.path))

  // Remove sessions whose files have been deleted
  removeStale(db, allPaths)

  const cachedMtimes = getMtimeMap(db)

  const staleFiles = refresh
    ? allFiles
    : allFiles.filter(f => cachedMtimes.get(f.path) !== f.mtime)

  // Always attempt Claude sync — it checks history.jsonl mtime independently
  const needsClaudeSync = !opts.tool || opts.tool === 'claude'
  const hasNonClaudeWork = staleFiles.some(f => f.tool !== 'claude')

  if (!needsClaudeSync && !hasNonClaudeWork && staleFiles.length === 0) return

  // Sort newest first — for the fast path we parse top-N and stop
  staleFiles.sort((a, b) => b.mtime - a.mtime)

  // Claude is handled as a batch (needs history.jsonl join)
  const nonClaudeStale = staleFiles.filter(f => f.tool !== 'claude')

  // Fast path: only parse what's needed to satisfy the query + a small buffer
  const parseLimit = refresh ? nonClaudeStale.length : Math.max(limit, 50)
  const toParse = nonClaudeStale.slice(0, parseLimit)

  const parsed = await Promise.all(toParse.map(f => parseFileRef(f, opts)))
  const valid = parsed.filter((s): s is Session => s !== null)
  upsertMany(db, valid)

  // Claude batch sync (always runs when Claude is in scope — history.jsonl changes independently)
  if (needsClaudeSync) {
    await syncClaude(db, allFiles, cachedMtimes, opts)
  }
}
