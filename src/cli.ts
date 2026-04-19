#!/usr/bin/env bun
import { openDb, querySessions } from './db.ts'
import { sync } from './indexer.ts'
import { runPicker } from './picker.tsx'
import { launch } from './launcher.ts'
import pkg from '../package.json'

const VERSION = pkg.version

function printHelp() {
  console.log(`pickup v${VERSION} — better AI session resume picker

Usage:
  pickup [options]

Options:
  --json              Output sessions as JSON (no TUI)
  --tool <name>       Filter by tool: claude, codex, copilot
  --limit <n>         Max sessions to show (default: 10)
  --refresh           Force re-index all session files
  --version           Print version
  --help              Print this help

Examples:
  pickup --json
  pickup --tool codex --limit 20
  pickup --json --limit 5000
`)
}

interface Args {
  json: boolean
  tool?: 'claude' | 'copilot' | 'codex'
  limit: number
  refresh: boolean
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = { json: false, limit: 10, refresh: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      args.json = true
    } else if (arg === '--refresh') {
      args.refresh = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg === '--version' || arg === '-v') {
      console.log(VERSION)
      process.exit(0)
    } else if (arg === '--tool') {
      const val = argv[++i]
      if (!val || !['claude', 'codex', 'copilot'].includes(val)) {
        console.error(`pickup: --tool must be one of: claude, codex, copilot`)
        process.exit(1)
      }
      args.tool = val as Args['tool']
    } else if (arg === '--limit') {
      const val = argv[++i]
      const n = parseInt(val ?? '', 10)
      if (isNaN(n) || n < 1) {
        console.error(`pickup: --limit must be a positive integer`)
        process.exit(1)
      }
      args.limit = n
    } else if (arg?.startsWith('--')) {
      console.error(`pickup: unknown option '${arg}'. Run pickup --help for usage.`)
      process.exit(1)
    }
  }

  return args
}

function formatSessionTable(sessions: Awaited<ReturnType<typeof querySessions>>) {
  if (sessions.length === 0) {
    console.log('No sessions found.')
    return
  }

  const now = Date.now()

  function relativeTime(ms: number): string {
    const diff = now - ms
    const m = Math.floor(diff / 60_000)
    const h = Math.floor(diff / 3_600_000)
    const d = Math.floor(diff / 86_400_000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    if (h < 24) return `${h}h ago`
    if (d === 1) return 'yesterday'
    return `${d}d ago`
  }

  function shortenPath(p: string): string {
    const home = process.env.HOME ?? ''
    return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p
  }

  for (const s of sessions) {
    const time = relativeTime(s.updatedAt)
    const cwd = shortenPath(s.cwd)
    console.log(`[${s.tool}] ${cwd}  (${time})`)
    if (s.lastUser) console.log(`  you: ${s.lastUser}`)
    if (s.lastAgent) console.log(`  ai:  ${s.lastAgent}`)
    console.log(`  id:  ${s.id}`)
    console.log()
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  if (!args) return

  const db = openDb()

  // Sync: index new/changed files before querying
  await sync(db, {
    limit: args.limit,
    tool: args.tool,
    refresh: args.refresh,
  })

  const sessions = querySessions(db, {
    tool: args.tool,
    limit: args.limit,
  })

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2))
  } else if (process.stdout.isTTY) {
    const selected = await runPicker(sessions)
    if (selected.length > 0) launch(selected)
  } else {
    // Non-TTY (piped output) — fall back to table
    formatSessionTable(sessions)
  }
}

main().catch(err => {
  console.error('pickup error:', err)
  process.exit(1)
})
