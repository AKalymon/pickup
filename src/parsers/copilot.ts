import { type Session } from './types.ts'
import { truncateMessage } from '../format.ts'
import { scanTailForLastMessages } from './tail-scan.ts'
import { join, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface WorkspaceYaml {
  id: string
  cwd: string
  created_at: string
  updated_at: string
  summary_count?: number
}

const TAIL_BYTES = 32768

// ─── I/O entry points ─────────────────────────────────────────────────────────

/** Parse all Copilot sessions found under the given sessions directory. */
export async function parseCopilotSessions(sessionsDir?: string): Promise<Session[]> {
  const base = sessionsDir ?? join(process.env.HOME ?? '', '.copilot', 'session-state')
  const glob = new Bun.Glob('*/workspace.yaml')
  const results: Session[] = []

  try {
    for await (const rel of glob.scan({ cwd: base, onlyFiles: true })) {
      const session = await parseCopilotWorkspace(join(base, rel))
      if (session) results.push(session)
    }
  } catch {
    // dir doesn't exist or isn't readable
  }

  return results
}

/** Parse a single Copilot session from its workspace.yaml file. */
export async function parseCopilotWorkspace(filePath: string): Promise<Session | null> {
  const text = await readFileOrNull(filePath)
  if (!text) return null

  const metadata = parseCopilotWorkspaceYaml(text)
  if (!metadata) return null

  const stat     = await Bun.file(filePath).stat()
  const messages = await readLastMessages(dirname(filePath))

  return buildSession(filePath, stat.mtimeMs, metadata, messages)
}

// ─── Pure functions ───────────────────────────────────────────────────────────

/** Parse workspace YAML text. Returns null if invalid or missing required fields. */
export function parseCopilotWorkspaceYaml(text: string): WorkspaceYaml | null {
  try {
    const data = parseYaml(text) as WorkspaceYaml
    if (!data?.id || !data?.cwd) return null
    return data
  } catch {
    return null
  }
}

/** Parse events.jsonl text and extract the last user and agent messages. */
export function parseCopilotEvents(text: string): { lastUser?: string; lastAgent?: string } {
  if (!text.trim()) return {}
  const { lastUser: rawUser, lastAgent: rawAgent } = scanTailForLastMessages(text, (parsed) => {
    const e = parsed as { type: string; data: { content?: string } }
    const content = e.data?.content
    if (!content) return null
    if (e.type === 'user.message')      return { role: 'user',  content }
    if (e.type === 'assistant.message') return { role: 'agent', content }
    return null
  })
  return {
    lastUser:  rawUser  ? truncateMessage(rawUser)  : undefined,
    lastAgent: rawAgent ? truncateMessage(rawAgent) : undefined,
  }
}

// ─── File collection ──────────────────────────────────────────────────────────

export async function collectCopilotFiles(sessionsDir?: string): Promise<string[]> {
  const base = sessionsDir ?? join(process.env.HOME ?? '', '.copilot', 'session-state')
  const glob = new Bun.Glob('*/workspace.yaml')
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

// ─── Private helpers ──────────────────────────────────────────────────────────

async function readLastMessages(
  sessionDir: string,
): Promise<{ lastUser?: string; lastAgent?: string }> {
  const eventsPath = join(sessionDir, 'events.jsonl')
  try {
    const file = Bun.file(eventsPath)
    const size = (await file.stat()).size
    if (size === 0) return {}
    const raw      = size > TAIL_BYTES ? await file.slice(size - TAIL_BYTES).text() : await file.text()
    const startIdx = size > TAIL_BYTES ? raw.indexOf('\n') + 1 : 0
    return parseCopilotEvents(raw.slice(startIdx))
  } catch {
    return {}
  }
}

function buildSession(
  filePath: string,
  fileMtime: number,
  data: WorkspaceYaml,
  messages: { lastUser?: string; lastAgent?: string },
): Session {
  return {
    id:        data.id,
    tool:      'copilot',
    cwd:       data.cwd,
    updatedAt: resolveUpdatedAt(data),
    lastUser:  messages.lastUser,
    lastAgent: messages.lastAgent,
    filePath,
    fileMtime,
  }
}

function resolveUpdatedAt(data: WorkspaceYaml): number {
  return data.updated_at
    ? new Date(data.updated_at).getTime()
    : new Date(data.created_at).getTime()
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try { return await Bun.file(filePath).text() } catch { return null }
}
