import { spawnSync } from 'node:child_process'

export interface Emulator {
  name: string
  buildArgv: (cmd: string[]) => string[]
}

// Ordered by reliability of detection
const EMULATORS: Array<{ envKey?: string; bin: string; buildArgv: (cmd: string[]) => string[] }> = [
  {
    envKey: 'KITTY_PID',
    bin: 'kitty',
    buildArgv: (cmd) => ['kitty', '--hold', '--', ...cmd],
  },
  {
    envKey: 'ALACRITTY_LOG',
    bin: 'alacritty',
    buildArgv: (cmd) => ['alacritty', '-e', ...cmd],
  },
  {
    envKey: 'WEZTERM_PANE',
    bin: 'wezterm',
    buildArgv: (cmd) => ['wezterm', 'start', '--', ...cmd],
  },
  {
    bin: 'gnome-terminal',
    buildArgv: (cmd) => ['gnome-terminal', '--', ...cmd],
  },
  {
    bin: 'xterm',
    buildArgv: (cmd) => ['xterm', '-e', ...cmd],
  },
]

function isOnPath(bin: string): boolean {
  const result = spawnSync('which', [bin], { stdio: 'pipe' })
  return result.status === 0
}

export function detectEmulator(): Emulator | null {
  for (const e of EMULATORS) {
    const matchesEnv = e.envKey ? !!process.env[e.envKey] : false
    const available  = matchesEnv || isOnPath(e.bin)
    if (available) {
      return { name: e.bin, buildArgv: e.buildArgv }
    }
  }
  return null
}
