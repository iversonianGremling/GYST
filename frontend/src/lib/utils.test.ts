import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { slugify, formatRelative, formatDate } from './utils'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(slugify('Héllo! World?')).toBe('hllo-world')
  })

  it('collapses multiple separators', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--foo--')).toBe('foo')
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })
})

describe('formatRelative', () => {
  const NOW = new Date('2026-05-16T12:00:00Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for < 1 minute', () => {
    expect(formatRelative(new Date(NOW - 30_000).toISOString())).toBe('just now')
  })

  it('returns minutes ago for < 1 hour', () => {
    expect(formatRelative(new Date(NOW - 15 * 60_000).toISOString())).toBe('15m ago')
  })

  it('returns hours ago for < 24 hours', () => {
    expect(formatRelative(new Date(NOW - 3 * 3_600_000).toISOString())).toBe('3h ago')
  })

  it('returns days ago for < 7 days', () => {
    expect(formatRelative(new Date(NOW - 2 * 86_400_000).toISOString())).toBe('2d ago')
  })

  it('returns formatted date for >= 7 days', () => {
    expect(formatRelative(new Date(NOW - 10 * 86_400_000).toISOString())).toMatch(/May/)
  })
})

describe('formatDate', () => {
  it('formats an ISO date string', () => {
    const result = formatDate('2026-01-15T10:00:00Z')
    expect(result).toMatch(/Jan/)
    expect(result).toMatch(/2026/)
  })
})
