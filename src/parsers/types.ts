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
