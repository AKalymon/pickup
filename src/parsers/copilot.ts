import { type Session, truncate } from './types.ts'
import { join, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'

interface WorkspaceYaml {
  id: string
  cwd: string
  created_at: string
  updated_at: string
  summary_count?: number
}

const TAIL_BYTES = 32768

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
    // Skip potential partial first line if we sliced mid-file
    const startIdx = size > TAIL_BYTES ? raw.indexOf('\n') + 1 : 0
    text = raw.slice(startIdx)
  } catch {
    return {}
  }

  const lines = text.split('\n').filter(Boolean).reverse()
  let lastUser: string | undefined
  let lastAgent: string | undefined

  for (const line of lines) {
    if (lastUser && lastAgent) break
    let entry: { type: string; data: { content?: string } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const content = entry.data?.content
    if (!content) continue
    if (!lastUser && entry.type === 'user.message') lastUser = truncate(content)
    if (!lastAgent && entry.type === 'assistant.message') lastAgent = truncate(content)
  }

  return { lastUser, lastAgent }
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

  let data: WorkspaceYaml
  try {
    data = parseYaml(text) as WorkspaceYaml
  } catch {
    return null
  }

  if (!data?.id || !data?.cwd) return null

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
