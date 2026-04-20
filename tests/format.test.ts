import { test, expect, describe } from 'bun:test'
import { describeTimeAgo, abbreviateHomePath, truncateMessage } from '../src/format.ts'

describe('describeTimeAgo', () => {
  const now = 1_000_000_000_000

  test('just now for < 1 minute', () => {
    expect(describeTimeAgo(now - 30_000, now)).toBe('just now')
  })

  test('just now for 0ms difference', () => {
    expect(describeTimeAgo(now, now)).toBe('just now')
  })

  test('minutes ago', () => {
    expect(describeTimeAgo(now - 5 * 60_000, now)).toBe('5m ago')
  })

  test('59 minutes ago', () => {
    expect(describeTimeAgo(now - 59 * 60_000, now)).toBe('59m ago')
  })

  test('hours ago', () => {
    expect(describeTimeAgo(now - 3 * 3_600_000, now)).toBe('3h ago')
  })

  test('23 hours ago', () => {
    expect(describeTimeAgo(now - 23 * 3_600_000, now)).toBe('23h ago')
  })

  test('yesterday for exactly 1 day', () => {
    expect(describeTimeAgo(now - 86_400_000, now)).toBe('yesterday')
  })

  test('days ago', () => {
    expect(describeTimeAgo(now - 5 * 86_400_000, now)).toBe('5d ago')
  })

  test('uses Date.now() when nowMs omitted', () => {
    const recent = Date.now() - 2 * 60_000
    expect(describeTimeAgo(recent)).toBe('2m ago')
  })
})

describe('abbreviateHomePath', () => {
  test('replaces home prefix with ~', () => {
    expect(abbreviateHomePath('/home/user/projects/foo', '/home/user')).toBe('~/projects/foo')
  })

  test('leaves path unchanged when home is empty', () => {
    expect(abbreviateHomePath('/home/user/projects/foo', '')).toBe('/home/user/projects/foo')
  })

  test('leaves path unchanged when it does not start with home', () => {
    expect(abbreviateHomePath('/tmp/foo', '/home/user')).toBe('/tmp/foo')
  })

  test('handles exact home directory', () => {
    expect(abbreviateHomePath('/home/user', '/home/user')).toBe('~')
  })
})

describe('truncateMessage', () => {
  test('returns short text unchanged', () => {
    expect(truncateMessage('hello world')).toBe('hello world')
  })

  test('truncates at maxChars with ellipsis', () => {
    const long = 'a'.repeat(100)
    const result = truncateMessage(long, 80)
    expect(result.length).toBe(80)
    expect(result.endsWith('…')).toBe(true)
  })

  test('collapses whitespace', () => {
    expect(truncateMessage('hello   \n  world')).toBe('hello world')
  })

  test('trims leading and trailing whitespace', () => {
    expect(truncateMessage('  hello  ')).toBe('hello')
  })

  test('respects custom maxChars', () => {
    const result = truncateMessage('hello world', 7)
    expect(result).toBe('hello …')
    expect(result.length).toBe(7)
  })

  test('does not truncate text exactly at limit', () => {
    const text = 'a'.repeat(80)
    expect(truncateMessage(text, 80)).toBe(text)
  })
})
