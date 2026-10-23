/** Code a `/` may follow when it opens a regex literal rather than divides. */
const REGEX_MAY_START =
  /(?:^|[(,=:[!&|?{};>]|\b(?:return|typeof|case|throw|yield|await|void|in|of|delete|instanceof|new|else|do))\s*$/

/**
 * The source with its comments removed, so a documented `'limit'` or a
 * commented-out `parseListQuery(` decides nothing. A scanner rather than a
 * lazy block-comment regex, which is polynomial on unterminated `/*` runs. A
 * `//` right after `:` is a URL scheme, not a comment. Quoted strings, template
 * literals and regex literals are copied as-is, so a `/*` inside one hides
 * nothing. A `'` or `"` string ends at a newline, and a quote that never
 * closes is kept alone and scanning goes on, so a quote the scanner misreads
 * cannot shelter a comment.
 */
export function stripComments(source: string): string {
  let code = ''
  let index = 0
  while (index < source.length) {
    const quote = source[index]
    if (quote === "'" || quote === '"' || quote === '`') {
      let end = index + 1
      while (
        end < source.length &&
        source[end] !== quote &&
        (quote === '`' || source[end] !== '\n')
      )
        end += source[end] === '\\' ? 2 : 1
      // An unclosed quote is a misread one: keep only the quote and scan on.
      const closed = source[end] === quote
      code += closed ? source.slice(index, end + 1) : quote
      index = closed ? end + 1 : index + 1
    } else if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      code += ' '
    } else if (source.startsWith('//', index) && source[index - 1] !== ':') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
    } else if (quote === '/' && REGEX_MAY_START.test(code.slice(-80))) {
      const end = regexEnd(source, index)
      code += source.slice(index, end)
      index = end
    } else {
      code += source[index]
      index++
    }
  }
  return code
}

/** Index just past a regex literal opening at `start`, or `start + 1` when none closes on its line. */
function regexEnd(source: string, start: number): number {
  let inClass = false
  for (let end = start + 1; end < source.length && source[end] !== '\n'; end++) {
    const char = source[end]
    if (char === '\\') end++
    else if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) return end + 1
  }
  return start + 1
}
