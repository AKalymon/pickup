import { describe, test, expect } from 'bun:test'
import { findTerminalEmulator } from '../src/terminal.ts'
import type { WhichLookup, EnvironmentVars } from '../src/ports.ts'

function makeEnv(vars: Record<string, string>): EnvironmentVars {
  return { get: (key) => vars[key] }
}

function makeWhich(available: string[]): WhichLookup {
  return { isOnPath: (bin) => available.includes(bin) }
}

const emptyEnv   = makeEnv({})
const nothingOn  = makeWhich([])

describe('findTerminalEmulator', () => {
  test('returns null when nothing is available', () => {
    expect(findTerminalEmulator(emptyEnv, nothingOn)).toBeNull()
  })

  test('detects kitty via KITTY_PID env var', () => {
    const emulator = findTerminalEmulator(makeEnv({ KITTY_PID: '123' }), nothingOn)
    expect(emulator).not.toBeNull()
    expect(emulator!.name).toBe('kitty')
  })

  test('detects alacritty via ALACRITTY_LOG env var', () => {
    const emulator = findTerminalEmulator(makeEnv({ ALACRITTY_LOG: '/tmp/log' }), nothingOn)
    expect(emulator!.name).toBe('alacritty')
  })

  test('detects wezterm via WEZTERM_PANE env var', () => {
    const emulator = findTerminalEmulator(makeEnv({ WEZTERM_PANE: '0' }), nothingOn)
    expect(emulator!.name).toBe('wezterm')
  })

  test('detects iTerm via TERM_PROGRAM', () => {
    const emulator = findTerminalEmulator(makeEnv({ TERM_PROGRAM: 'iTerm.app' }), nothingOn)
    expect(emulator!.name).toBe('iTerm')
  })

  test('detects Terminal.app via TERM_PROGRAM', () => {
    const emulator = findTerminalEmulator(makeEnv({ TERM_PROGRAM: 'Apple_Terminal' }), nothingOn)
    expect(emulator!.name).toBe('Terminal.app')
  })

  test('falls back to PATH detection when env vars absent', () => {
    const emulator = findTerminalEmulator(emptyEnv, makeWhich(['xterm']))
    expect(emulator!.name).toBe('xterm')
  })

  test('prefers env-matched emulator over PATH-only', () => {
    // kitty matches env, xterm is on path — kitty wins (first match wins)
    const emulator = findTerminalEmulator(makeEnv({ KITTY_PID: '1' }), makeWhich(['xterm']))
    expect(emulator!.name).toBe('kitty')
  })

  test('detects gnome-terminal via PATH', () => {
    const emulator = findTerminalEmulator(emptyEnv, makeWhich(['gnome-terminal']))
    expect(emulator!.name).toBe('gnome-terminal')
  })

  test('buildTerminalCommand wraps the command for kitty', () => {
    const emulator = findTerminalEmulator(makeEnv({ KITTY_PID: '1' }), nothingOn)
    const cmd = emulator!.buildTerminalCommand(['claude', '--resume', 'abc'])
    expect(cmd).toEqual(['kitty', '--hold', '--', 'claude', '--resume', 'abc'])
  })

  test('buildTerminalCommand wraps the command for alacritty', () => {
    const emulator = findTerminalEmulator(makeEnv({ ALACRITTY_LOG: '/log' }), nothingOn)
    const cmd = emulator!.buildTerminalCommand(['codex', 'resume', 'xyz'])
    expect(cmd).toEqual(['alacritty', '-e', 'codex', 'resume', 'xyz'])
  })

  test('buildTerminalCommand wraps the command for wezterm', () => {
    const emulator = findTerminalEmulator(makeEnv({ WEZTERM_PANE: '0' }), nothingOn)
    const cmd = emulator!.buildTerminalCommand(['claude', '--resume', 'abc'])
    expect(cmd).toEqual(['wezterm', 'start', '--', 'claude', '--resume', 'abc'])
  })

  test('buildTerminalCommand wraps the command for iTerm', () => {
    const emulator = findTerminalEmulator(makeEnv({ TERM_PROGRAM: 'iTerm.app' }), nothingOn)
    const cmd = emulator!.buildTerminalCommand(['claude', '--resume', 'abc'], '/Users/test/My Project')
    expect(cmd).toEqual([
      'osascript',
      '-e', 'tell application id "com.googlecode.iterm2"',
      '-e', 'activate',
      '-e', 'create window with default profile',
      '-e', `tell current session of current window to write text "cd '/Users/test/My Project' && exec 'claude' '--resume' 'abc'"`,
      '-e', 'end tell',
    ])
  })

  test('buildTerminalCommand wraps the command for Terminal.app', () => {
    const emulator = findTerminalEmulator(makeEnv({ TERM_PROGRAM: 'Apple_Terminal' }), nothingOn)
    const cmd = emulator!.buildTerminalCommand(['claude', '--resume', 'abc'], "/Users/test/it's me")
    expect(cmd).toEqual([
      'osascript',
      '-e', 'tell application id "com.apple.Terminal"',
      '-e', 'activate',
      '-e', `do script "cd '/Users/test/it'\\\\''s me' && exec 'claude' '--resume' 'abc'"`,
      '-e', 'end tell',
    ])
  })

  test('buildTerminalCommand wraps the command for gnome-terminal', () => {
    const emulator = findTerminalEmulator(emptyEnv, makeWhich(['gnome-terminal']))
    const cmd = emulator!.buildTerminalCommand(['claude', '--resume', 'abc'])
    expect(cmd).toEqual(['gnome-terminal', '--', 'claude', '--resume', 'abc'])
  })

  test('buildTerminalCommand wraps the command for xterm', () => {
    const emulator = findTerminalEmulator(emptyEnv, makeWhich(['xterm']))
    const cmd = emulator!.buildTerminalCommand(['claude', '--resume', 'abc'])
    expect(cmd).toEqual(['xterm', '-e', 'claude', '--resume', 'abc'])
  })
})
