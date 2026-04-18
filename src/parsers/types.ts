export interface Session {
  id: string
  tool: 'claude' | 'copilot' | 'codex'
  cwd: string
  updatedAt: number     // unix ms
  lastUser?: string     // truncated ~80 chars
  lastAgent?: string    // truncated ~80 chars
  filePath: string
  fileMtime: number
}

export function truncate(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
