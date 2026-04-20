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

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Discover all session files, parse anything new or changed, and write
 * results to the database. Removes entries for files that no longer exist.
 */
export async function syncSessionsToDatabase(
  db: Database,
  opts: SyncOptions,
  fs: FileSystem,
): Promise<void> {
  const allFiles     = await discoverSessionFiles(opts, fs)
  const cachedMtimes = getMtimeMap(db)

  removeDeletedFiles(db, allFiles)

  const staleFiles = findStaleFiles(allFiles, cachedMtimes, opts.refresh ?? false)

  if (nothingToDo(staleFiles, opts)) return

  await parseAndIndexNonClaudeSessions(db, staleFiles, opts, fs)

  if (claudeIsInScope(opts)) {
    await syncClaudeSessions(db, allFiles, cachedMtimes, opts, fs)
  }
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/** Glob all session files across enabled tools and stat each one. */
export async function discoverSessionFiles(
  opts: SyncOptions,
  fs: FileSystem,
): Promise<SessionFileRef[]> {
  const home = opts.homeDir ?? process.env.HOME ?? ''

  const discoveries: Array<{ pattern: string; cwd: string; toolName: SessionFileRef['tool'] }> = []
  if (!opts.tool || opts.tool === 'codex')   discoveries.push({ pattern: '**/*.jsonl',        cwd: join(home, '.codex',   'sessions'),      toolName: 'codex'   })
  if (!opts.tool || opts.tool === 'claude')  discoveries.push({ pattern: '*.json',            cwd: join(home, '.claude',  'sessions'),      toolName: 'claude'  })
  if (!opts.tool || opts.tool === 'copilot') discoveries.push({ pattern: '*/workspace.yaml',  cwd: join(home, '.copilot', 'session-state'), toolName: 'copilot' })

  const fileGroups = await Promise.all(
    discoveries.map(async ({ pattern, cwd, toolName }) => {
      const paths = await fs.globFiles(pattern, cwd)
      return paths.map(p => ({ path: p, tool: toolName }))
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

// ─── Sync steps ───────────────────────────────────────────────────────────────

async function parseAndIndexNonClaudeSessions(
  db: Database,
  staleFiles: SessionFileRef[],
  opts: SyncOptions,
  fs: FileSystem,
): Promise<void> {
  const { maxFilesToParse = 10, refresh = false } = opts
  const nonClaudeStale = staleFiles.filter(f => f.tool !== 'claude')
  const parseLimit     = refresh ? nonClaudeStale.length : Math.max(maxFilesToParse, 50)
  const toParse        = prioritizeFilesForParsing(nonClaudeStale, parseLimit)
  const sessions       = await parseAllFiles(toParse, fs)
  upsertMany(db, sessions)
}

/** Sync all Claude sessions as a batch — requires a history.jsonl join. */
async function syncClaudeSessions(
  db: Database,
  allFiles: SessionFileRef[],
  cachedMtimes: Map<string, number>,
  opts: SyncOptions,
  fs: FileSystem,
): Promise<void> {
  const home = opts.homeDir ?? process.env.HOME ?? ''
  const claudeFiles = allFiles.filter(f => f.tool === 'claude')
  if (claudeFiles.length === 0) return

  const historyPath  = join(home, '.claude', 'history.jsonl')
  const historyMtime = await statMtime(historyPath, fs)

  const isStale = opts.refresh
    || claudeFiles.some(f => cachedMtimes.get(f.path) !== f.mtime)
    || historyMtime !== getTrackedMtime(db, historyPath)

  if (!isStale) return

  const metas   = await readAllSessionMetas(claudeFiles, fs)
  const history = parseClaudeHistory(await readFileOrEmpty(historyPath, fs))
  upsertMany(db, joinClaudeSessionsWithHistory(metas, history))

  setTrackedMtime(db, historyPath, historyMtime)
}

// ─── File parsing ─────────────────────────────────────────────────────────────

async function parseAllFiles(files: SessionFileRef[], fs: FileSystem): Promise<Session[]> {
  const results = await Promise.all(files.map(f => parseSessionFile(f, fs)))
  return results.filter((s): s is Session => s !== null)
}

async function parseSessionFile(ref: SessionFileRef, fs: FileSystem): Promise<Session | null> {
  if (ref.tool === 'codex')   return parseCodexFile(ref, fs)
  if (ref.tool === 'copilot') return parseCopilotFile(ref, fs)
  return null
}

async function parseCodexFile(ref: SessionFileRef, fs: FileSystem): Promise<Session | null> {
  try {
    const text = await fs.readTextFile(ref.path)
    return parseCodexSessionText(text, ref.path, ref.mtime)
  } catch {
    return null
  }
}

async function parseCopilotFile(ref: SessionFileRef, fs: FileSystem): Promise<Session | null> {
  const workspaceText = await readFileOrNull(ref.path, fs)
  if (!workspaceText) return null

  const data = parseCopilotWorkspaceYaml(workspaceText)
  if (!data) return null

  const eventsText = await readFileOrEmpty(join(dirname(ref.path), 'events.jsonl'), fs)
  const { lastUser, lastAgent } = parseCopilotEvents(eventsText)
  const updatedAt = data.updated_at
    ? new Date(data.updated_at).getTime()
    : new Date(data.created_at).getTime()

  return { id: data.id, tool: 'copilot', cwd: data.cwd, updatedAt, lastUser, lastAgent, filePath: ref.path, fileMtime: ref.mtime }
}

async function readAllSessionMetas(
  files: SessionFileRef[],
  fs: FileSystem,
): Promise<Array<ReturnType<typeof parseClaudeSessionJson> & { filePath: string; fileMtime: number }>> {
  const results = await Promise.all(
    files.map(async f => {
      try {
        const raw  = await fs.readTextFile(f.path)
        const meta = parseClaudeSessionJson(raw)
        if (!meta) return null
        return { ...meta, filePath: f.path, fileMtime: f.mtime }
      } catch {
        return null
      }
    }),
  )
  return results.filter((m): m is NonNullable<typeof m> => m !== null)
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Return files whose mtime differs from the cached value (or all if refresh). */
export function findStaleFiles(
  allFiles: SessionFileRef[],
  cachedMtimes: Map<string, number>,
  refresh: boolean,
): SessionFileRef[] {
  return refresh ? allFiles : allFiles.filter(f => cachedMtimes.get(f.path) !== f.mtime)
}

/** Sort stale files newest-first and take up to maxCount. */
export function prioritizeFilesForParsing(
  staleFiles: SessionFileRef[],
  maxCount: number,
): SessionFileRef[] {
  return [...staleFiles].sort((a, b) => b.mtime - a.mtime).slice(0, maxCount)
}

function removeDeletedFiles(db: Database, allFiles: SessionFileRef[]): void {
  removeStale(db, new Set(allFiles.map(f => f.path)))
}

function nothingToDo(staleFiles: SessionFileRef[], opts: SyncOptions): boolean {
  return !claudeIsInScope(opts)
    && staleFiles.every(f => f.tool === 'claude')
    && staleFiles.length === 0
}

function claudeIsInScope(opts: SyncOptions): boolean {
  return !opts.tool || opts.tool === 'claude'
}

// ─── I/O utilities ────────────────────────────────────────────────────────────

async function readFileOrEmpty(path: string, fs: FileSystem): Promise<string> {
  try { return await fs.readTextFile(path) } catch { return '' }
}

async function readFileOrNull(path: string, fs: FileSystem): Promise<string | null> {
  try { return await fs.readTextFile(path) } catch { return null }
}

async function statMtime(path: string, fs: FileSystem): Promise<number> {
  try { return (await fs.statFile(path)).mtimeMs } catch { return 0 }
}
