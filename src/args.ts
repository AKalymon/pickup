export interface Args {
  json: boolean
  tool?: 'claude' | 'copilot' | 'codex'
  limit: number
  refresh: boolean
}

export type ParseResult =
  | { kind: 'ok'; args: Args }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }

export function parseArgs(argv: string[]): ParseResult {
  const args: Args = { json: false, limit: 10, refresh: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      args.json = true
    } else if (arg === '--refresh') {
      args.refresh = true
    } else if (arg === '--help' || arg === '-h') {
      return { kind: 'help' }
    } else if (arg === '--version' || arg === '-v') {
      return { kind: 'version' }
    } else if (arg === '--tool') {
      const val = argv[++i]
      if (!val || !['claude', 'codex', 'copilot'].includes(val)) {
        return { kind: 'error', message: 'pickup: --tool must be one of: claude, codex, copilot' }
      }
      args.tool = val as Args['tool']
    } else if (arg === '--limit') {
      const val = argv[++i]
      const n = parseInt(val ?? '', 10)
      if (isNaN(n) || n < 1) {
        return { kind: 'error', message: 'pickup: --limit must be a positive integer' }
      }
      args.limit = n
    } else if (arg?.startsWith('--')) {
      return { kind: 'error', message: `pickup: unknown option '${arg}'. Run pickup --help for usage.` }
    }
  }

  return { kind: 'ok', args }
}
