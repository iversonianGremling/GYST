import { describe, it, expect } from 'vitest'
import { extractWikilinks, resolveWikilinks } from './wikilinks'

describe('extractWikilinks', () => {
  it('returns empty array for plain text', () => {
    expect(extractWikilinks('no links here')).toEqual([])
  })

  it('extracts a single wikilink', () => {
    expect(extractWikilinks('see [[My Note]]')).toEqual(['My Note'])
  })

  it('extracts multiple wikilinks', () => {
    expect(extractWikilinks('[[A]] and [[B]] and [[C]]')).toEqual(['A', 'B', 'C'])
  })

  it('ignores incomplete brackets', () => {
    expect(extractWikilinks('[not a link]')).toEqual([])
    expect(extractWikilinks('[[unclosed')).toEqual([])
  })

  it('handles wikilinks inline with other markdown', () => {
    const md = '# Title\n\nSee [[Related]] for more on [[Topic]].'
    expect(extractWikilinks(md)).toEqual(['Related', 'Topic'])
  })
})

describe('resolveWikilinks', () => {
  const resolver = (title: string) => `/notes?slug=${encodeURIComponent(title.toLowerCase())}`

  it('replaces [[Title]] with a markdown link', () => {
    const result = resolveWikilinks('see [[My Note]]', resolver)
    expect(result).toBe('see [My Note](/notes?slug=my%20note)')
  })

  it('leaves plain text unchanged', () => {
    expect(resolveWikilinks('no links', resolver)).toBe('no links')
  })

  it('resolves multiple wikilinks in one pass', () => {
    const result = resolveWikilinks('[[A]] and [[B]]', resolver)
    expect(result).toBe('[A](/notes?slug=a) and [B](/notes?slug=b)')
  })

  it('uses the resolver return value as href', () => {
    const result = resolveWikilinks('[[X]]', () => '/custom/path')
    expect(result).toBe('[X](/custom/path)')
  })
})
