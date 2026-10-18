/** Case/accent-insensitive word search for human names and joined identifiers. */
export function normalizeSearchText(value: string): string {
  return (
    value
      .normalize('NFD')
      .replaceAll(/\p{M}/gu, '')
      .toLowerCase()
      // A final sigma and an ordinary sigma are the same caseless letter. This
      // also removes lowercasing's only context-sensitive Unicode default rule.
      .replaceAll('ς', 'σ')
      .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  )
}

export function searchTokens(needle: string): string[] {
  const normalized = normalizeSearchText(needle)
  return normalized ? normalized.split(' ') : []
}

/** All query words must occur, in any order; punctuation separates words. */
export function matchesSearchText(text: string, needle: string): boolean {
  const haystack = normalizeSearchText(text)
  return searchTokens(needle).every((word) => haystack.includes(word))
}
