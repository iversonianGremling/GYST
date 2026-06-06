/**
 * Parse [[wikilink]] syntax and return a list of linked titles.
 * Used by the editor to build the link graph client-side for preview.
 */
export function extractWikilinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[\[([^\]]+)\]\]/g)
  return [...matches].map((m) => m[1])
}

/** Mirror of the backend _slugify so wikilink titles map to note slugs. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Replace [[Title]] with a markdown link. The resolver returns an href for a
 * known note, or null for an unresolved link — which is rendered as a special
 * `#new:Title` href so the preview can style it and offer to create the note.
 */
export function resolveWikilinks(markdown: string, resolver: (title: string) => string | null): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
    const title = String(raw).trim()
    const href = resolver(title)
    return href ? `[${title}](${href})` : `[${title}](#new:${encodeURIComponent(title)})`
  })
}
