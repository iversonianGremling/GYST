/**
 * Parse [[wikilink]] syntax and return a list of linked titles.
 * Used by the editor to build the link graph client-side for preview.
 */
export function extractWikilinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[\[([^\]]+)\]\]/g)
  return [...matches].map((m) => m[1])
}

/**
 * Replace [[Title]] with a markdown link pointing to /notes?slug=...
 */
export function resolveWikilinks(markdown: string, resolver: (title: string) => string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const href = resolver(title)
    return `[${title}](${href})`
  })
}
