import { describe, test, expect } from 'bun:test'
import { detectEmulator } from '../src/terminal.ts'

describe('detectEmulator', () => {
  test('returns an emulator object or null', () => {
    const result = detectEmulator()
    if (result !== null) {
      expect(typeof result.name).toBe('string')
      expect(typeof result.buildArgv).toBe('function')
    } else {
      expect(result).toBeNull()
    }
  })

  test('buildArgv wraps the given command', () => {
    const result = detectEmulator()
    if (!result) return // skip if no emulator available in CI

    const argv = result.buildArgv(['claude', '--resume', 'abc'])
    expect(argv.length).toBeGreaterThan(3)
    // The resume command should appear somewhere in the argv
    expect(argv.join(' ')).toContain('claude')
    expect(argv.join(' ')).toContain('--resume')
  })
})
