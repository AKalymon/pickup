import { type Session } from './types.ts'
import { truncateMessage } from '../format.ts'
import { scanTailForLastMessages } from './tail-scan.ts'

// How many bytes to read from the end of a JSONL to find the last messages.
// 32KB covers long agent replies and interleaved tool output lines.
const TAIL_BYTES = 32768

/** Pure: parse a codex session from raw JSONL text. */
export function parseCodexSessionText(
  text: string,
  filePath: string,
  fileMtimeMs: number,
): Session | null {
  if (!text.trim()) return null

  const firstNewline = text.indexOf('\n')
  if (firstNewline === -1) return null

  let meta: { type: string; payload: { id: string; cwd: string; timestamp: string } }
  try {
    meta = JSON.parse(text.slice(0, firstNewline))
  } catch {
    return null
  }

  if (meta.type !== 'session_meta' || !meta.payload?.id) return null

  const tail = text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text
  const tailStart = text.length > TAIL_BYTES ? tail.indexOf('\n') + 1 : 0
  const tailText = tail.slice(tailStart)

  const { lastUser: rawUser, lastAgent: rawAgent } = scanTailForLastMessages(tailText, (parsed) => {
    const e = parsed as { type: string; payload: { type: string; message: string } }
    if (e.type !== 'event_msg') return null
    const kind = e.payload?.type
    const content = e.payload?.message
    if (!content) return null
    if (kind === 'user_message') return { role: 'user', content }
    if (kind === 'agent_message') return { role: 'agent', content }
    return null
  })

  return {
    id: meta.payload.id,
    tool: 'codex',
    cwd: meta.payload.cwd,
    updatedAt: new Date(meta.payload.timestamp).getTime(),
    lastUser: rawUser ? truncateMessage(rawUser) : undefined,
    lastAgent: rawAgent ? truncateMessage(rawAgent) : undefined,
    filePath,
    fileMtime: fileMtimeMs,
  }
}

/** I/O wrapper: read a codex session file and parse it. */
export async function parseCodexSession(filePath: string): Promise<Session | null> {
  const file = Bun.file(filePath)
  let text: string
  try {
    text = await file.text()
  } catch {
    return null
  }
  const stat = await file.stat()
  return parseCodexSessionText(text, filePath, stat.mtimeMs)
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
