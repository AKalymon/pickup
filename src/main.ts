#!/usr/bin/env bun
import pkg                    from '../package.json'
import { parseArgs }          from './args.ts'
import { openDb, querySessions } from './db.ts'
import { syncSessionsToDatabase } from './indexer.ts'
import { runPicker }          from './picker.tsx'
import { launchSessions }     from './launcher.ts'
import { findTerminalEmulator } from './terminal.ts'
import { bunFileSystem, bunSpawner, processEnv, bunWhich } from './adapters.ts'
import { describeTimeAgo, abbreviateHomePath } from './format.ts'
import type { Database }      from 'bun:sqlite'
import type { Args }          from './args.ts'
import type { Session }       from './parsers/types.ts'

const VERSION = pkg.version

// ─── What this program does, top to bottom ───────────────────────────────────

async function main() {
  const args     = parseInputOrExit()
  const db       = openDatabase()

  await           indexLatestSessions(db, args)
  const sessions = loadSessionsFromDatabase(db, args)

  if (args.json)       return printJson(sessions)
  if (isInteractive()) return await letUserPickAndLaunch(sessions)
                       return printTable(sessions)
}

main().catch(crashWithError)

// ─── Steps (in order of use above) ───────────────────────────────────────────

function parseInputOrExit(): Args {
  const result = parseArgs(process.argv.slice(2))
  if (result.kind === 'help')    { printUsage(); process.exit(0) }
  if (result.kind === 'version') { console.log(VERSION); process.exit(0) }
  if (result.kind === 'error')   { console.error(result.message); process.exit(1) }
  return result.args
}

function openDatabase(): Database {
  return openDb()
}

async function indexLatestSessions(db: Database, args: Args): Promise<void> {
  await syncSessionsToDatabase(db, {
    maxFilesToParse: args.limit,
    tool:    args.tool,
    refresh: args.refresh,
  }, bunFileSystem)
}

function loadSessionsFromDatabase(db: Database, args: Args): Session[] {
  return querySessions(db, { tool: args.tool, limit: args.limit })
}

function isInteractive(): boolean {
  return !!process.stdout.isTTY
}

function printJson(sessions: Session[]): void {
  console.log(JSON.stringify(sessions, null, 2))
}

async function letUserPickAndLaunch(sessions: Session[]): Promise<void> {
  const selected = await runPicker(sessions)
  if (selected.length > 0) {
    await launchSessions(selected, {
      spawner:      bunSpawner,
      findEmulator: () => findTerminalEmulator(processEnv, bunWhich),
      exit:         process.exit as (code: number) => never,
      logError:     console.error,
    })
  }
}

function printTable(sessions: Session[]): void {
  if (sessions.length === 0) { console.log('No sessions found.'); return }

  const now  = Date.now()
  const home = process.env.HOME ?? ''

  for (const s of sessions) {
    console.log(`[${s.tool}] ${abbreviateHomePath(s.cwd, home)}  (${describeTimeAgo(s.updatedAt, now)})`)
    if (s.lastUser)  console.log(`  you: ${s.lastUser}`)
    if (s.lastAgent) console.log(`  ai:  ${s.lastAgent}`)
    console.log(`  id:  ${s.id}`)
    console.log()
  }
}

function crashWithError(err: unknown): never {
  console.error('pickup error:', err)
  process.exit(1)
}

// ─── Usage text ───────────────────────────────────────────────────────────────

function printUsage(): void {
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
