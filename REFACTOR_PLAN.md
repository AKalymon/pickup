# Plan: Refactor pickup for Complete Testability

## Context

The pickup CLI works well but has testability problems: side effects are mixed into business logic, functions do multiple things, utility code is duplicated, and several modules can't be unit tested without real filesystems or subprocesses. The goal is to make every function independently testable with pure inputs/outputs, make `main()` read like plain English, and achieve complete test coverage.

## Architecture: Ports & Adapters (Lightweight)

All I/O boundaries get explicit interfaces. Business logic becomes pure functions. Real implementations are wired only in `main.ts`. No DI container — just function parameters.

## New File Structure

```
src/
  main.ts              — Entry point orchestrator (plain English)
  args.ts              — CLI argument parsing (pure, no process.exit)
  format.ts            — Shared formatting: describeTimeAgo, abbreviateHomePath, truncateMessage
  ports.ts             — I/O interfaces: FileSystem, ProcessSpawner, WhichLookup, EnvironmentVars
  adapters.ts          — Real Bun/Node implementations of ports
  db.ts                — SQLite operations (already clean, minor renames)
  indexer.ts           — Sync logic with injected FileSystem
  launcher.ts          — Launch logic with injected ProcessSpawner
  terminal.ts          — Terminal detection with injected WhichLookup + EnvironmentVars
  picker.tsx           — React/Ink TUI (imports from format.ts, otherwise unchanged)
  parsers/
    types.ts           — Session interface (unchanged)
    tail-scan.ts       — NEW: extracted shared tail-scanning logic (pure)
    claude.ts          — Pure parsing functions + I/O wrapper
    codex.ts           — Pure parsing functions + I/O wrapper
    copilot.ts         — Pure parsing functions + I/O wrapper

tests/
  args.test.ts         — NEW
  format.test.ts       — NEW
  tail-scan.test.ts    — NEW
  db.test.ts           — Existing (already good)
  indexer.test.ts      — Rewritten with fake FileSystem
  launcher.test.ts     — Rewritten with fake ProcessSpawner
  terminal.test.ts     — Rewritten with fake WhichLookup/EnvironmentVars
  parsers/
    claude.test.ts     — Rewritten: pure functions, no filesystem
    codex.test.ts      — Rewritten: pure functions, no filesystem
    copilot.test.ts    — Rewritten: pure functions, no filesystem
```

## Key Interfaces (`src/ports.ts`)

```typescript
export interface FileSystem {
  readTextFile(path: string): Promise<string>
  statFile(path: string): Promise<{ mtimeMs: number; size: number }>
  globFiles(pattern: string, cwd: string): Promise<string[]>
}

export interface ProcessSpawner {
  spawnSync(bin: string, args: string[], opts?: { stdio?: string; cwd?: string }): {
    status: number | null; error?: NodeJS.ErrnoException
  }
  spawnDetached(bin: string, args: string[], opts?: { cwd?: string }): {
    onError(cb: (err: NodeJS.ErrnoException) => void): void; unref(): void
  }
}

export interface WhichLookup {
  isOnPath(bin: string): boolean
}

export interface EnvironmentVars {
  get(key: string): string | undefined
}
```

## Function Renames

| Current | New | Why |
|---|---|---|
| `parseArgs` → returns `Args \| null` | `parseArgs` → returns `ParseResult` union | No side effects, pattern-matchable |
| `relativeTime(ms)` | `describeTimeAgo(timestampMs, nowMs?)` | Pure, testable with fixed time |
| `shortenPath(p)` | `abbreviateHomePath(fullPath, homeDir)` | No env read |
| `truncate` (types.ts) | `truncateMessage` (format.ts) | Clearer purpose |
| `FileRef` | `SessionFileRef` | Specific |
| `SyncOptions.limit` | `SyncOptions.maxFilesToParse` | Clarifies what's limited |
| `buildResumeArgv` | `buildResumeCommand` | Plain English |
| `cwdFor` | `determineWorkingDirectory` | Self-documenting |
| `emulator.buildArgv` | `emulator.buildTerminalCommand` | Terminal-specific |
| `launchSingle` | `launchInCurrentTerminal` | Describes behavior |
| `launchMultiple` | `launchInNewWindows` | Describes behavior |
| `collectAndStat` | `discoverSessionFiles` | Plain English |
| `sync` | `syncSessionsToDatabase` | Self-documenting |
| `detectEmulator` | `findTerminalEmulator` | Plain English |

## Refactored `main.ts` (the "plain English" orchestrator)

```typescript
async function main() {
  const parsed = parseArgs(process.argv.slice(2))

  if (parsed.kind === 'help')    { printUsage(); process.exit(0) }
  if (parsed.kind === 'version') { console.log(VERSION); process.exit(0) }
  if (parsed.kind === 'error')   { console.error(parsed.message); process.exit(1) }

  const { args } = parsed
  const db = openDatabase()

  await syncSessionsToDatabase(db, {
    maxFilesToParse: args.limit,
    tool: args.tool,
    refresh: args.refresh,
  }, bunFileSystem)

  const sessions = querySessions(db, { tool: args.tool, limit: args.limit })

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2))
  } else if (process.stdout.isTTY) {
    const selected = await runPicker(sessions)
    if (selected.length > 0) {
      launchSessions(selected, { spawner: realSpawner, findEmulator, exit: process.exit, logError: console.error })
    }
  } else {
    printSessionTable(sessions)
  }
}
```

## Module Refactoring Details

### PR 1: Extract `format.ts` and `args.ts`
- **`src/format.ts`**: Move `relativeTime` → `describeTimeAgo(timestampMs, nowMs?)`, `shortenPath` → `abbreviateHomePath(fullPath, homeDir)`, `truncate` → `truncateMessage(text, maxChars)` from cli.ts, picker.tsx, and parsers/types.ts. All pure.
- **`src/args.ts`**: Extract `parseArgs` from cli.ts. Return discriminated union `{ kind: 'ok' | 'help' | 'version' | 'error' }` instead of calling `process.exit()`.
- **Tests**: `tests/args.test.ts` (~10 tests), `tests/format.test.ts` (~12 tests)
- Update picker.tsx and cli.ts to import from format.ts (remove duplicates)

### PR 2: Extract `parsers/tail-scan.ts`
- **`src/parsers/tail-scan.ts`**: Extract the duplicated tail-scanning logic from codex.ts (lines 36-58) and copilot.ts (lines 15-53) into `scanTailForLastMessages(text, config)`. Pure function — takes text and a line classifier, returns `{ lastUser?, lastAgent? }`.
- **Tests**: `tests/parsers/tail-scan.test.ts` (~6 tests)
- Refactor codex.ts and copilot.ts to use it

### PR 3: Create `ports.ts` and `adapters.ts`
- Define all I/O interfaces in `src/ports.ts`
- Implement real Bun/Node adapters in `src/adapters.ts`
- No consumers yet — foundation only

### PR 4: Refactor parsers to pure functions + I/O wrappers
- **codex.ts**: Extract `parseCodexSessionText(text, filePath, fileMtimeMs): Session | null` — pure, no I/O. Keep `parseCodexSession(filePath, fs)` as thin I/O wrapper.
- **claude.ts**: Extract `parseClaudeSessionJson(raw)`, `parseClaudeHistory(historyText)`, `joinClaudeSessionsWithHistory(metas, history)` — all pure. Keep I/O wrapper.
- **copilot.ts**: Extract `parseCopilotWorkspaceYaml(yamlText)`, `parseCopilotEvents(eventsText)` — pure. Keep I/O wrapper.
- **Tests**: Rewrite all parser tests to pass string data directly. No temp files needed. ~38 tests total.

### PR 5: Refactor `terminal.ts` and `launcher.ts`
- **terminal.ts**: `findTerminalEmulator(env, which)` — takes injected `EnvironmentVars` and `WhichLookup`. Rename `buildArgv` → `buildTerminalCommand`.
- **launcher.ts**: `launchInCurrentTerminal(session, spawner, exit, logError)`, `launchInNewWindows(sessions, emulator, spawner, logError): { failures }`, `launchSessions(sessions, deps)` as entry point. Rename `buildResumeArgv` → `buildResumeCommand`, `cwdFor` → `determineWorkingDirectory`.
- **Tests**: ~20 tests total, all deterministic (fake spawner, fake env, fake which)

### PR 6: Refactor `indexer.ts`
- Extract pure functions: `findStaleFiles(allFiles, cachedMtimes, refresh)`, `prioritizeFilesForParsing(staleFiles, maxCount, refresh)`
- `discoverSessionFiles(opts, fs)` and `syncSessionsToDatabase(db, opts, fs)` take injected FileSystem
- Rename `FileRef` → `SessionFileRef`, `limit` → `maxFilesToParse`
- **Tests**: ~10 tests, no temp directories

### PR 7: Create `main.ts`, retire `cli.ts`
- New `src/main.ts` as orchestrator (shown above)
- Wire all real adapters at top level
- Update package.json entry and compile script
- Delete `src/cli.ts`

## Test Coverage Target

| Module | Current | After |
|---|---|---|
| args.ts | 0 | ~10 |
| format.ts | 0 | ~12 |
| parsers/tail-scan.ts | 0 | ~6 |
| db.ts | 8 | 8 (unchanged) |
| parsers/claude.ts | 11 | ~14 |
| parsers/codex.ts | 9 | ~12 |
| parsers/copilot.ts | 10 | ~12 |
| terminal.ts | 2 (skip in CI) | ~8 (always run) |
| launcher.ts | 6 | ~12 |
| indexer.ts | 8 | ~10 |
| **Total** | **~54** | **~104** |

## Verification

After each PR:
1. `bun test` — all tests pass
2. `bun run src/cli.ts` (or `src/main.ts` after PR 7) — app works interactively
3. `bun run src/cli.ts --json --limit 5` — JSON output works
4. `bun build ./src/cli.ts --compile --outfile dist/pickup` — binary compiles

After PR 7 (final):
1. All 104+ tests pass with `bun test`
2. `bun run src/main.ts` launches picker, selecting a session resumes it
3. `bun run src/main.ts --json | jq .` produces valid JSON
4. Non-TTY pipe: `bun run src/main.ts | cat` prints table
5. `bun build ./src/main.ts --compile --outfile dist/pickup && ./dist/pickup --help` works
