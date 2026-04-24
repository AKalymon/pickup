import type { WhichLookup, EnvironmentVars } from './ports.ts'

export interface Emulator {
  name: string
  buildTerminalCommand(cmd: string[], cwd?: string): string[]
}

// Ordered by reliability of detection
const EMULATORS: Array<{
  name: string
  envKey?: string
  envValue?: string
  bin: string
  detectOnPath?: boolean
  buildTerminalCommand(cmd: string[], cwd?: string): string[]
}> = [
  {
    name: 'kitty',
    envKey: 'KITTY_PID',
    bin: 'kitty',
    buildTerminalCommand: (cmd) => ['kitty', '--hold', '--', ...cmd],
  },
  {
    name: 'alacritty',
    envKey: 'ALACRITTY_LOG',
    bin: 'alacritty',
    buildTerminalCommand: (cmd) => ['alacritty', '-e', ...cmd],
  },
  {
    name: 'wezterm',
    envKey: 'WEZTERM_PANE',
    bin: 'wezterm',
    buildTerminalCommand: (cmd) => ['wezterm', 'start', '--', ...cmd],
  },
  {
    name: 'Ghostty',
    envKey: 'TERM_PROGRAM',
    envValue: 'ghostty',
    bin: 'open',
    detectOnPath: false,
    buildTerminalCommand: (cmd, cwd) => buildGhosttyCommand(cmd, cwd),
  },
  {
    name: 'iTerm',
    envKey: 'TERM_PROGRAM',
    envValue: 'iTerm.app',
    bin: 'osascript',
    detectOnPath: false,
    buildTerminalCommand: (cmd, cwd) => buildItermCommand(cmd, cwd),
  },
  {
    name: 'Terminal.app',
    envKey: 'TERM_PROGRAM',
    envValue: 'Apple_Terminal',
    bin: 'osascript',
    detectOnPath: false,
    buildTerminalCommand: (cmd, cwd) => buildTerminalAppCommand(cmd, cwd),
  },
  {
    name: 'gnome-terminal',
    bin: 'gnome-terminal',
    buildTerminalCommand: (cmd) => ['gnome-terminal', '--', ...cmd],
  },
  {
    name: 'xterm',
    bin: 'xterm',
    buildTerminalCommand: (cmd) => ['xterm', '-e', ...cmd],
  },
]

export function findTerminalEmulator(env: EnvironmentVars, which: WhichLookup): Emulator | null {
  for (const e of EMULATORS) {
    const envValue = e.envKey ? env.get(e.envKey) : undefined
    const matchesEnv = e.envKey
      ? (e.envValue === undefined ? !!envValue : envValue === e.envValue)
      : false
    const available = matchesEnv || (e.detectOnPath !== false && which.isOnPath(e.bin))
    if (available) {
      return { name: e.name, buildTerminalCommand: e.buildTerminalCommand }
    }
  }
  return null
}

function buildItermCommand(cmd: string[], cwd?: string): string[] {
  const shellCommand = buildShellCommand(cmd, cwd)
  return [
    'osascript',
    '-e', 'tell application id "com.googlecode.iterm2"',
    '-e', 'activate',
    '-e', 'create window with default profile',
    '-e', `tell current session of current window to write text ${appleScriptString(shellCommand)}`,
    '-e', 'end tell',
  ]
}

function buildTerminalAppCommand(cmd: string[], cwd?: string): string[] {
  const shellCommand = buildShellCommand(cmd, cwd)
  return [
    'osascript',
    '-e', 'tell application id "com.apple.Terminal"',
    '-e', 'activate',
    '-e', `do script ${appleScriptString(shellCommand)}`,
    '-e', 'end tell',
  ]
}

function buildGhosttyCommand(cmd: string[], cwd?: string): string[] {
  const args = ['open', '-na', 'Ghostty.app', '--args']
  if (cwd) args.push(`--working-directory=${cwd}`)
  return [...args, '-e', ...cmd]
}

function buildShellCommand(cmd: string[], cwd?: string): string {
  const resume = `exec ${cmd.map(shellQuote).join(' ')}`
  return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function appleScriptString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')}"`
}
