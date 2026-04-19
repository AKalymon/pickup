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

/** Pure: parse workspace YAML text. Returns null if invalid. */
export function parseCopilotWorkspaceYaml(text: string): WorkspaceYaml | null {
  try {
    const data = parseYaml(text) as WorkspaceYaml
    if (!data?.id || !data?.cwd) return null
    return data
  } catch {
    return null
  }
}

/** Pure: parse events.jsonl text and extract last user/agent messages. */
export function parseCopilotEvents(text: string): { lastUser?: string; lastAgent?: string } {
  if (!text.trim()) return {}
  const { lastUser: rawUser, lastAgent: rawAgent } = scanTailForLastMessages(text, (parsed) => {
    const e = parsed as { type: string; data: { content?: string } }
    const content = e.data?.content
    if (!content) return null
    if (e.type === 'user.message') return { role: 'user', content }
    if (e.type === 'assistant.message') return { role: 'agent', content }
    return null
  })
  return {
    lastUser: rawUser ? truncateMessage(rawUser) : undefined,
    lastAgent: rawAgent ? truncateMessage(rawAgent) : undefined,
  }
}

async function readLastMessages(
  sessionDir: string,
): Promise<{ lastUser?: string; lastAgent?: string }> {
  const eventsPath = join(sessionDir, 'events.jsonl')
  let text: string
  try {
    const file = Bun.file(eventsPath)
    const size = (await file.stat()).size
    if (size === 0) return {}
    const raw = size > TAIL_BYTES
      ? await file.slice(size - TAIL_BYTES).text()
      : await file.text()
    const startIdx = size > TAIL_BYTES ? raw.indexOf('\n') + 1 : 0
    text = raw.slice(startIdx)
  } catch {
    return {}
  }
  return parseCopilotEvents(text)
}

export async function parseCopilotSessions(sessionsDir?: string): Promise<Session[]> {
  const base = sessionsDir ?? join(process.env.HOME ?? '', '.copilot', 'session-state')
  const glob = new Bun.Glob('*/workspace.yaml')
  const results: Session[] = []

  try {
    for await (const rel of glob.scan({ cwd: base, onlyFiles: true })) {
      const filePath = join(base, rel)
      const session = await parseCopilotWorkspace(filePath)
      if (session) results.push(session)
    }
  } catch {
    // dir doesn't exist or isn't readable
  }

  return results
}

export async function parseCopilotWorkspace(filePath: string): Promise<Session | null> {
  let text: string
  try {
    text = await Bun.file(filePath).text()
  } catch {
    return null
  }

  const data = parseCopilotWorkspaceYaml(text)
  if (!data) return null

  const stat = await Bun.file(filePath).stat()
  const updatedAt = data.updated_at
    ? new Date(data.updated_at).getTime()
    : new Date(data.created_at).getTime()

  const { lastUser, lastAgent } = await readLastMessages(dirname(filePath))

  return {
    id: data.id,
    tool: 'copilot',
    cwd: data.cwd,
    updatedAt,
    lastUser,
    lastAgent,
    filePath,
    fileMtime: stat.mtimeMs,
  }
}

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
