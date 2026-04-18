import { type Session, truncate } from './types.ts'

// How many bytes to read from the end of a JSONL to find the last messages.
// 32KB covers long agent replies and interleaved tool output lines.
const TAIL_BYTES = 32768

export async function parseCodexSession(filePath: string): Promise<Session | null> {
  const file = Bun.file(filePath)

  let text: string
  try {
    text = await file.text()
  } catch {
    return null
  }

  if (!text.trim()) return null

  // --- First line: session_meta ---
  const firstNewline = text.indexOf('\n')
  if (firstNewline === -1) return null

  let meta: {
    type: string
    payload: { id: string; cwd: string; timestamp: string }
  }
  try {
    meta = JSON.parse(text.slice(0, firstNewline))
  } catch {
    return null
  }

  if (meta.type !== 'session_meta' || !meta.payload?.id) return null

  // --- Tail: scan backwards for last user + agent messages ---
  const tail = text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text
  // Skip any partial first line that got cut mid-way
  const tailStart = text.length > TAIL_BYTES ? tail.indexOf('\n') + 1 : 0
  const tailLines = tail.slice(tailStart).split('\n').filter(Boolean).reverse()

  let lastUser: string | undefined
  let lastAgent: string | undefined

  for (const line of tailLines) {
    if (lastUser && lastAgent) break
    let entry: { type: string; payload: { type: string; message: string } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'event_msg') continue
    const kind = entry.payload?.type
    const msg = entry.payload?.message
    if (!msg) continue
    if (!lastUser && kind === 'user_message') lastUser = truncate(msg)
    if (!lastAgent && kind === 'agent_message') lastAgent = truncate(msg)
  }

  const stat = await file.stat()

  return {
    id: meta.payload.id,
    tool: 'codex',
    cwd: meta.payload.cwd,
    updatedAt: new Date(meta.payload.timestamp).getTime(),
    lastUser,
    lastAgent,
    filePath,
    fileMtime: stat.mtimeMs,
  }
}

export async function collectCodexFiles(sessionsDir?: string): Promise<string[]> {
  const base = sessionsDir ?? `${process.env.HOME}/.codex/sessions`
  const glob = new Bun.Glob('**/*.jsonl')
  const files: string[] = []
  try {
    for await (const f of glob.scan({ cwd: base, onlyFiles: true })) {
      files.push(`${base}/${f}`)
    }
  } catch {
    // dir doesn't exist or isn't readable
  }
  return files
}
