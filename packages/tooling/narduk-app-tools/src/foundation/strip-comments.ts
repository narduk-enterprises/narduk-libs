/**
 * The source with its comments removed, so a documented `'limit'` or a
 * commented-out `parseListQuery(` decides nothing. A scanner rather than a
 * lazy block-comment regex, which is polynomial on unterminated `/*` runs. A
 * `//` right after `:` is a URL scheme, not a comment.
 */
export function stripComments(source: string): string {
  let code = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      code += ' '
    } else if (source.startsWith('//', index) && source[index - 1] !== ':') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
    } else {
      code += source[index]
      index++
    }
  }
  return code
}
