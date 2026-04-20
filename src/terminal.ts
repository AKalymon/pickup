import type { WhichLookup, EnvironmentVars } from './ports.ts'

export interface Emulator {
  name: string
  buildTerminalCommand(cmd: string[]): string[]
}

// Ordered by reliability of detection
const EMULATORS: Array<{
  envKey?: string
  bin: string
  buildTerminalCommand(cmd: string[]): string[]
}> = [
  {
    envKey: 'KITTY_PID',
    bin: 'kitty',
    buildTerminalCommand: (cmd) => ['kitty', '--hold', '--', ...cmd],
  },
  {
    envKey: 'ALACRITTY_LOG',
    bin: 'alacritty',
    buildTerminalCommand: (cmd) => ['alacritty', '-e', ...cmd],
  },
  {
    envKey: 'WEZTERM_PANE',
    bin: 'wezterm',
    buildTerminalCommand: (cmd) => ['wezterm', 'start', '--', ...cmd],
  },
  {
    bin: 'gnome-terminal',
    buildTerminalCommand: (cmd) => ['gnome-terminal', '--', ...cmd],
  },
  {
    bin: 'xterm',
    buildTerminalCommand: (cmd) => ['xterm', '-e', ...cmd],
  },
]

export function findTerminalEmulator(env: EnvironmentVars, which: WhichLookup): Emulator | null {
  for (const e of EMULATORS) {
    const matchesEnv = e.envKey ? !!env.get(e.envKey) : false
    const available  = matchesEnv || which.isOnPath(e.bin)
    if (available) {
      return { name: e.bin, buildTerminalCommand: e.buildTerminalCommand }
    }
  }
  return null
}
