import { type Database } from 'bun:sqlite'
import { getMtimeMap, upsertMany, removeStale, getTrackedMtime, setTrackedMtime } from './db.ts'
import { type Session } from './parsers/types.ts'
import { parseCodexSessionText } from './parsers/codex.ts'
import { parseClaudeSessionJson, parseClaudeHistory, joinClaudeSessionsWithHistory } from './parsers/claude.ts'
import { parseCopilotWorkspaceYaml, parseCopilotEvents } from './parsers/copilot.ts'
import type { FileSystem } from './ports.ts'
import { join, dirname } from 'node:path'

export interface SyncOptions {
  /** Max sessions needed for the current query — limits how many new files we parse */
  maxFilesToParse?: number
  /** If set, only process sessions from this tool */
  tool?: 'claude' | 'copilot' | 'codex'
  /** Force re-parse of all files regardless of mtime */
  refresh?: boolean
  /** Custom home dir for testing */
  homeDir?: string
}

export interface SessionFileRef {
  path: string
  tool: 'claude' | 'copilot' | 'codex'
  mtime: number
}

/** Pure: return files whose mtime differs from the cached value (or all if refresh). */
export function findStaleFiles(
  allFiles: SessionFileRef[],
  cachedMtimes: Map<string, number>,
  refresh: boolean,
): SessionFileRef[] {
  return refresh ? allFiles : allFiles.filter(f => cachedMtimes.get(f.path) !== f.mtime)
}

/** Pure: sort stale files newest-first and take up to maxCount. */
export function prioritizeFilesForParsing(
  staleFiles: SessionFileRef[],
  maxCount: number,
): SessionFileRef[] {
  return [...staleFiles].sort((a, b) => b.mtime - a.mtime).slice(0, maxCount)
}

/** I/O: collect and stat all session files across enabled tools. */
export async function discoverSessionFiles(
  opts: SyncOptions,
  fs: FileSystem,
): Promise<SessionFileRef[]> {
  const home = opts.homeDir ?? process.env.HOME ?? ''
  const { tool } = opts

  const discoveries: Array<{ pattern: string; cwd: string; toolName: 'claude' | 'codex' | 'copilot' }> = []

  if (!tool || tool === 'codex') {
    discoveries.push({ pattern: '**/*.jsonl', cwd: join(home, '.codex', 'sessions'), toolName: 'codex' })
  }
  if (!tool || tool === 'claude') {
    discoveries.push({ pattern: '*.json', cwd: join(home, '.claude', 'sessions'), toolName: 'claude' })
  }
  if (!tool || tool === 'copilot') {
    discoveries.push({ pattern: '*/workspace.yaml', cwd: join(home, '.copilot', 'session-state'), toolName: 'copilot' })
  }

  const fileGroups = await Promise.all(
    discoveries.map(async ({ pattern, cwd, toolName }) => {
      const paths = await fs.globFiles(pattern, cwd)
      return paths.map(p => ({ path: p, tool: toolName as SessionFileRef['tool'] }))
    }),
  )

  const tagged = fileGroups.flat()

  const withMtime = await Promise.all(
    tagged.map(async f => {
      try {
        const stat = await fs.statFile(f.path)
        return { ...f, mtime: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )

  return withMtime.filter((f): f is SessionFileRef => f !== null)
}

/** Parse a single non-Claude session file using the injected FileSystem. */
async function parseSessionFile(
  ref: SessionFileRef,
  fs: FileSystem,
): Promise<Session | null> {
  if (ref.tool === 'codex') {
    let text: string
    try { text = await fs.readTextFile(ref.path) } catch { return null }
    return parseCodexSessionText(text, ref.path, ref.mtime)
  }

  if (ref.tool === 'copilot') {
    let workspaceText: string
    try { workspaceText = await fs.readTextFile(ref.path) } catch { return null }
    const data = parseCopilotWorkspaceYaml(workspaceText)
    if (!data) return null
    const eventsPath = join(dirname(ref.path), 'events.jsonl')
    let eventsText = ''
    try { eventsText = await fs.readTextFile(eventsPath) } catch { /* no events file */ }
    const { lastUser, lastAgent } = parseCopilotEvents(eventsText)
    const updatedAt = data.updated_at
      ? new Date(data.updated_at).getTime()
      : new Date(data.created_at).getTime()
    return {
      id: data.id,
      tool: 'copilot',
      cwd: data.cwd,
      updatedAt,
      lastUser,
      lastAgent,
      filePath: ref.path,
      fileMtime: ref.mtime,
    }
  }

  return null
}

/** Sync Claude sessions as a batch (requires history.jsonl join). */
async function syncClaude(
  db: Database,
  allFiles: SessionFileRef[],
  cachedMtimes: Map<string, number>,
  opts: SyncOptions,
  fs: FileSystem,
): Promise<void> {
  const home = opts.homeDir ?? process.env.HOME ?? ''
  const claudeFiles = allFiles.filter(f => f.tool === 'claude')
  if (claudeFiles.length === 0) return

  const historyPath = join(home, '.claude', 'history.jsonl')

  let historyMtime = 0
  try {
    historyMtime = (await fs.statFile(historyPath)).mtimeMs
  } catch { /* history.jsonl may not exist yet */ }

  const sessionFilesStale = claudeFiles.some(f => cachedMtimes.get(f.path) !== f.mtime)
  const historyStale = historyMtime !== getTrackedMtime(db, historyPath)
  const hasStale = opts.refresh || sessionFilesStale || historyStale

  if (!hasStale) return

  const metaResults = await Promise.all(
    claudeFiles.map(async f => {
      try {
        const raw = await fs.readTextFile(f.path)
        const meta = parseClaudeSessionJson(raw)
        if (!meta) return null
        return { ...meta, filePath: f.path, fileMtime: f.mtime }
      } catch {
        return null
      }
    }),
  )

  const metas = metaResults.filter((m): m is NonNullable<typeof m> => m !== null)

  let historyText = ''
  try { historyText = await fs.readTextFile(historyPath) } catch {}

  const history = parseClaudeHistory(historyText)
  const sessions = joinClaudeSessionsWithHistory(metas, history)
  upsertMany(db, sessions)

  setTrackedMtime(db, historyPath, historyMtime)
}

/**
 * Main sync function.
 *
 * Strategy:
 * 1. Discover + stat all session files (cheap — syscalls only)
 * 2. Diff against DB mtimes — find stale/new files
 * 3. Sort stale files by mtime DESC — parse newest first
 * 4. Parse only as many as needed (up to Math.max(maxFilesToParse, 50))
 *    OR all of them if --refresh
 * 5. Upsert results into SQLite
 * 6. Remove DB entries for files that no longer exist on disk
 */
export async function syncSessionsToDatabase(
  db: Database,
  opts: SyncOptions,
  fs: FileSystem,
): Promise<void> {
  const { maxFilesToParse = 10, refresh = false } = opts

  const allFiles = await discoverSessionFiles(opts, fs)
  const allPaths = new Set(allFiles.map(f => f.path))

  removeStale(db, allPaths)

  const cachedMtimes = getMtimeMap(db)
  const staleFiles = findStaleFiles(allFiles, cachedMtimes, refresh)

  const needsClaudeSync = !opts.tool || opts.tool === 'claude'
  const hasNonClaudeWork = staleFiles.some(f => f.tool !== 'claude')

  if (!needsClaudeSync && !hasNonClaudeWork && staleFiles.length === 0) return

  const nonClaudeStale = staleFiles.filter(f => f.tool !== 'claude')
  const parseLimit = refresh ? nonClaudeStale.length : Math.max(maxFilesToParse, 50)
  const toParse = prioritizeFilesForParsing(nonClaudeStale, parseLimit)

  const parsed = await Promise.all(toParse.map(f => parseSessionFile(f, fs)))
  const valid = parsed.filter((s): s is Session => s !== null)
  upsertMany(db, valid)

  if (needsClaudeSync) {
    await syncClaude(db, allFiles, cachedMtimes, opts, fs)
  }
}
