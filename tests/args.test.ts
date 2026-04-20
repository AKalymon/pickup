import { test, expect, describe } from 'bun:test'
import { parseArgs } from '../src/args.ts'

describe('parseArgs', () => {
  test('returns defaults with empty argv', () => {
    const result = parseArgs([])
    expect(result).toEqual({ kind: 'ok', args: { json: false, limit: 10, refresh: false } })
  })

  test('--json sets json flag', () => {
    const result = parseArgs(['--json'])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.args.json).toBe(true)
  })

  test('--refresh sets refresh flag', () => {
    const result = parseArgs(['--refresh'])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.args.refresh).toBe(true)
  })

  test('--help returns help kind', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' })
  })

  test('-h returns help kind', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' })
  })

  test('--version returns version kind', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' })
  })

  test('-v returns version kind', () => {
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' })
  })

  test('--tool sets tool', () => {
    const result = parseArgs(['--tool', 'claude'])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.args.tool).toBe('claude')
  })

  test('--tool with invalid value returns error', () => {
    const result = parseArgs(['--tool', 'vscode'])
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/--tool must be one of/)
  })

  test('--tool with missing value returns error', () => {
    const result = parseArgs(['--tool'])
    expect(result.kind).toBe('error')
  })

  test('--limit sets limit', () => {
    const result = parseArgs(['--limit', '25'])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.args.limit).toBe(25)
  })

  test('--limit with non-integer returns error', () => {
    const result = parseArgs(['--limit', 'abc'])
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/--limit must be a positive integer/)
  })

  test('--limit with zero returns error', () => {
    const result = parseArgs(['--limit', '0'])
    expect(result.kind).toBe('error')
  })

  test('unknown flag returns error', () => {
    const result = parseArgs(['--unknown'])
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/unknown option/)
  })

  test('multiple flags combined', () => {
    const result = parseArgs(['--json', '--tool', 'codex', '--limit', '5', '--refresh'])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.args).toEqual({ json: true, tool: 'codex', limit: 5, refresh: true })
    }
  })
})
