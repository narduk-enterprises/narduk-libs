/**
 * NeProse's markdown subset (narduk-libs#1005): a small, pure parser from a
 * markdown string to the plain-data AST in `ne-prose-types.ts`.
 *
 * Written here rather than taken from a library because narduk-shell declares
 * no markdown parser (`@nuxt/ui` does not bring one; `@nuxtjs/mdc` is not a
 * dependency) and the suite adds no runtime dependency for one component. It
 * is framework-free — no Vue, no DOM — so the package root can re-export it, a
 * server route can run it, and a unit test pins every construct without
 * mounting anything.
 *
 * It is XSS-safe by construction, not by sanitising: the parser only ever
 * produces text and a fixed set of node types, and NeProse renders each node
 * as an element with its text as a text node. Raw HTML in the source is text.
 * The one attribute that carries source content is a link's `href`, and every
 * href passes `safeProseHref` (here, and again at render time).
 *
 * The subset, and what it deliberately leaves out, is in the README's
 * `NeProse` section.
 */
import type {
  NeProseAlign,
  NeProseBlock,
  NeProseHeading,
  NeProseInline,
  NeProseListItem,
} from '../components/ne-prose-types'

/** Schemes a link may carry. Anything else with a scheme is dropped. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

/**
 * The href NeProse will render, or `null` to render the link's text alone.
 *
 * Allowed: `http:`, `https:`, `mailto:`, and anything with no scheme at all —
 * a relative path, a root path, `#fragment`, `?query`. ASCII control
 * characters and whitespace are removed before the scheme is read, because a
 * browser ignores them there (`java\tscript:` is `javascript:` to it), and the
 * cleaned value is the one returned.
 */
export function safeProseHref(raw: string): string | null {
  const cleaned = raw.replaceAll(/[\p{Cc}\s]/gu, '')
  if (cleaned === '') return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  if (!scheme) return cleaned
  return SAFE_SCHEMES.has((scheme[1] ?? '').toLowerCase()) ? cleaned : null
}

/**
 * A heading-id generator for one document. GitHub's rule: lowercase, drop
 * everything but letters, digits, spaces, `_` and `-`, spaces to `-`; a repeat
 * gets `-1`, `-2`, …. An empty result is `section`. Each document gets its own
 * generator so ids are stable for a given source.
 */
export function createProseSlugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    let base = text
      .toLowerCase()
      .trim()
      .replaceAll(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replaceAll(/\s+/g, '-')
    if (base === '') base = 'section'
    let id = base
    if (seen.has(base)) {
      let count = seen.get(base) ?? 0
      do {
        count += 1
        id = `${base}-${count}`
      } while (seen.has(id))
      seen.set(base, count)
    }
    seen.set(id, 0)
    return id
  }
}

/** Inline runs as plain text: what a heading's id and outline entry read. */
export function prosePlainText(runs: readonly NeProseInline[]): string {
  let out = ''
  for (const run of runs) {
    if (run.type === 'text' || run.type === 'code') out += run.value
    else if (run.type === 'break') out += ' '
    else out += prosePlainText(run.children)
  }
  return out
}

/**
 * The document's top-level headings, in order, for a table of contents. Takes
 * a source string or the blocks `parseProse` already produced (headings inside
 * a blockquote or a list are not sections, and are left out).
 */
export function proseOutline(input: string | readonly NeProseBlock[]): NeProseHeading[] {
  const blocks = typeof input === 'string' ? parseProse(input) : input
  const outline: NeProseHeading[] = []
  for (const block of blocks) {
    if (block.type === 'heading') {
      outline.push({ id: block.id, level: block.level, text: prosePlainText(block.children) })
    }
  }
  return outline
}

/** Parse a markdown string into NeProse's block AST. */
export function parseProse(source: string): NeProseBlock[] {
  const lines = source.replaceAll(/\r\n?/g, '\n').split('\n')
  return parseBlocks(lines, createProseSlugger())
}

// ---------------------------------------------------------------------------
// Blocks

const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const MARKER = /^( {0,3})([-*+]|(\d{1,9})[.)])(?:([ \t]+)(\S.*)?)?$/
const DELIMITER_CELL = /^:?-+:?$/

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** Leading whitespace width in columns, a tab advancing to the next stop of 4. */
function indentOf(line: string): number {
  let column = 0
  for (const char of line) {
    if (char === ' ') column += 1
    else if (char === '\t') column += 4 - (column % 4)
    else break
  }
  return column
}

/** Remove `columns` columns of leading whitespace, splitting a tab if needed. */
function stripColumns(line: string, columns: number): string {
  let column = 0
  let index = 0
  while (index < line.length && column < columns) {
    const char = line[index]
    if (char === ' ') column += 1
    else if (char === '\t') {
      const width = 4 - (column % 4)
      if (column + width > columns)
        return ' '.repeat(column + width - columns) + line.slice(index + 1)
      column += width
    } else break
    index += 1
  }
  return line.slice(index)
}

interface ListMarker {
  indent: number
  ordered: boolean
  start: number
  /** Column the item's content starts at; its continuation lines indent to it. */
  contentIndent: number
  content: string
}

function readMarker(line: string): ListMarker | null {
  const match = MARKER.exec(line)
  if (!match) return null
  const indent = (match[1] ?? '').length
  const marker = match[2] ?? ''
  const spacing = match[4] ?? ''
  const content = match[5] ?? ''
  // No content: the item's content column is one past the marker. More than
  // four spaces after the marker: the extra are content (CommonMark).
  const gap = content === '' || spacing.length > 4 ? 1 : spacing.length
  return {
    indent,
    ordered: match[3] !== undefined,
    start: match[3] === undefined ? 1 : Number(match[3]),
    contentIndent: indent + marker.length + gap,
    content: content === '' ? '' : ' '.repeat(Math.max(0, spacing.length - gap)) + content,
  }
}

function openFence(line: string): { indent: number; fence: string; lang: string | null } | null {
  // Read by hand rather than with one regex: `(`{3,})(.*)` backtracks
  // polynomially on a long run of backticks.
  const indent = runLength(line, 0, ' ')
  const char = line[indent] ?? ''
  if (indent > 3 || (char !== '`' && char !== '~')) return null
  const size = runLength(line, indent, char)
  if (size < 3) return null
  const fence = char.repeat(size)
  const info = line.slice(indent + size).trim()
  if (char === '`' && info.includes('`')) return null
  return { indent, fence, lang: info.split(/\s+/)[0] || null }
}

/** A line that ends a paragraph (and is never a lazy continuation of one). */
function startsBlock(line: string): boolean {
  if (ATX.test(line) || THEMATIC.test(line) || QUOTE.test(line) || openFence(line)) return true
  const marker = readMarker(line)
  return marker !== null && marker.content.trim() !== '' && (!marker.ordered || marker.start === 1)
}

function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim())
}

function readAlignment(line: string, columns: number): NeProseAlign[] | null {
  if (!line.includes('-')) return null
  const cells = splitRow(line)
  if (cells.length !== columns || !cells.every((cell) => DELIMITER_CELL.test(cell))) return null
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return left ? 'left' : null
  })
}

function heading(
  level: number,
  text: string,
  slug: (text: string) => string,
): Extract<NeProseBlock, { type: 'heading' }> {
  const children = parseInline(text)
  return {
    type: 'heading',
    level: level <= 2 ? 2 : 3,
    id: slug(prosePlainText(children)),
    children,
  }
}

function parseBlocks(lines: readonly string[], slug: (text: string) => string): NeProseBlock[] {
  const blocks: NeProseBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (isBlank(line)) {
      index += 1
      continue
    }

    const fence = openFence(line)
    if (fence) {
      const body: string[] = []
      index += 1
      const char = fence.fence[0] ?? '`'
      const close = new RegExp(`^ {0,3}\\${char}{${fence.fence.length},}[ \\t]*$`)
      while (index < lines.length && !close.test(lines[index] ?? '')) {
        body.push(stripColumns(lines[index] ?? '', fence.indent))
        index += 1
      }
      index += 1 // the closing fence, or past the end
      blocks.push({ type: 'code', lang: fence.lang, value: body.join('\n') })
      continue
    }

    const atx = ATX.exec(line)
    if (atx) {
      const text = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim()
      blocks.push(heading((atx[1] ?? '').length, text, slug))
      index += 1
      continue
    }

    if (THEMATIC.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const quoted = QUOTE.exec(current)
        if (quoted) inner.push(quoted[1] ?? '')
        else if (
          // A lazy continuation of a quoted paragraph.
          !isBlank(current) &&
          !isBlank(inner.at(-1) ?? '') &&
          !startsBlock(current)
        )
          inner.push(current)
        else break
        index += 1
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(inner, slug) })
      continue
    }

    const marker = readMarker(line)
    if (marker) {
      const [list, next] = parseList(lines, index, slug)
      blocks.push(list)
      index = next
      continue
    }

    const next = lines[index + 1]
    if (line.includes('|') && next !== undefined) {
      const head = splitRow(line)
      const align = readAlignment(next, head.length)
      if (align) {
        const rows: NeProseInline[][][] = []
        index += 2
        while (index < lines.length) {
          const current = lines[index] ?? ''
          if (isBlank(current) || startsBlock(current)) break
          const cells = splitRow(current)
          rows.push(align.map((_, column) => parseInline(cells[column] ?? '')))
          index += 1
        }
        blocks.push({ type: 'table', align, head: head.map((cell) => parseInline(cell)), rows })
        continue
      }
    }

    // A paragraph: this line and every following one that does not start a
    // block. A setext underline turns what came before into a heading.
    const text: string[] = [line.trimStart()]
    index += 1
    let setext: number | null = null
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (isBlank(current)) break
      const underline = SETEXT.exec(current)
      if (underline) {
        setext = (underline[1] ?? '').startsWith('=') ? 1 : 2
        index += 1
        break
      }
      if (startsBlock(current)) break
      text.push(current.trimStart())
      index += 1
    }
    const joined = text.join('\n').trimEnd()
    blocks.push(
      setext === null
        ? { type: 'paragraph', children: parseInline(joined) }
        : heading(setext, joined, slug),
    )
  }

  return blocks
}

/** One list from `start`; returns the list and the index of the next line. */
function parseList(
  lines: readonly string[],
  start: number,
  slug: (text: string) => string,
): [NeProseBlock, number] {
  const first = readMarker(lines[start] ?? '') as ListMarker
  const items: NeProseListItem[] = []
  let index = start

  while (index < lines.length) {
    const marker = readMarker(lines[index] ?? '')
    if (!marker || marker.ordered !== first.ordered || marker.indent > first.indent + 1) break

    const body: string[] = [marker.content]
    index += 1
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (isBlank(current)) {
        body.push('')
        index += 1
        continue
      }
      const indent = indentOf(current)
      if (indent >= marker.contentIndent) {
        body.push(stripColumns(current, marker.contentIndent))
      } else if (indent >= marker.indent + 2 && readMarker(current)) {
        // A nested list indented less than the content column — `1. step`
        // then `  - detail` — which is how most people write one.
        body.push(stripColumns(current, indent))
      } else if (!isBlank(body.at(-1) ?? '') && !startsBlock(current) && !readMarker(current)) {
        body.push(current.trimStart()) // a lazy paragraph continuation
      } else break
      index += 1
    }

    items.push({ children: parseBlocks(body, slug) })
  }

  const list: NeProseBlock = first.ordered
    ? { type: 'list', ordered: true, start: first.start, items }
    : { type: 'list', ordered: false, items }
  return [list, index]
}

// ---------------------------------------------------------------------------
// Inline

/** ASCII punctuation: what a backslash can escape. */
const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const URI_AUTOLINK = /<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/iy
const EMAIL_AUTOLINK =
  /<([\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)>/iy
const BARE_URL = /https?:\/\/[^\s<]+/iy
const WORD_CHAR = /[\p{L}\p{N}]/u

function pushText(out: NeProseInline[], value: string): void {
  if (value === '') return
  const last = out.at(-1)
  if (last?.type === 'text') last.value += value
  else out.push({ type: 'text', value })
}

function pushAll(out: NeProseInline[], runs: readonly NeProseInline[]): void {
  for (const run of runs) {
    if (run.type === 'text') pushText(out, run.value)
    else out.push(run)
  }
}

function runLength(text: string, at: number, char: string): number {
  let end = at
  while (text[end] === char) end += 1
  return end - at
}

/** Where the code span opening at `at` closes: `[contentEnd, end]`, or null. */
function codeSpanEnd(text: string, at: number): [number, number] | null {
  const open = runLength(text, at, '`')
  let search = at + open
  while (search < text.length) {
    const found = text.indexOf('`', search)
    if (found === -1) return null
    const close = runLength(text, found, '`')
    if (close === open) return [found, found + close]
    search = found + close
  }
  return null
}

interface LinkParts {
  text: string
  destination: string
  end: number
}

/** `[text](destination "title")` opening at `at`, or null. */
function readLink(text: string, at: number): LinkParts | null {
  let depth = 0
  let index = at
  for (; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') index += 1
    else if (char === '`') {
      const span = codeSpanEnd(text, index)
      if (span) index = span[1] - 1
    } else if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) break
    }
  }
  if (index >= text.length || text[index + 1] !== '(') return null
  const label = text.slice(at + 1, index)

  let cursor = index + 2
  const skipSpace = () => {
    while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1
  }
  skipSpace()

  let destination = ''
  if (text[cursor] === '<') {
    const close = text.indexOf('>', cursor)
    if (close === -1 || text.slice(cursor, close).includes('\n')) return null
    destination = text.slice(cursor + 1, close)
    cursor = close + 1
  } else {
    let parens = 0
    while (cursor < text.length) {
      const char = text[cursor] ?? ''
      if (char === '\\' && ESCAPABLE.test(text[cursor + 1] ?? '')) {
        destination += text[cursor + 1]
        cursor += 2
        continue
      }
      if (/\s/.test(char)) break
      if (char === '(') parens += 1
      if (char === ')') {
        if (parens === 0) break
        parens -= 1
      }
      destination += char
      cursor += 1
    }
  }

  skipSpace()
  const quote = text[cursor]
  if (quote === '"' || quote === "'" || quote === '(') {
    const closer = quote === '(' ? ')' : quote
    const close = text.indexOf(closer, cursor + 1)
    if (close === -1) return null
    cursor = close + 1
    skipSpace()
  }
  if (text[cursor] !== ')') return null
  return { text: label, destination, end: cursor + 1 }
}

/** The closing delimiter run of exactly `size` `char`s after `from`, or -1. */
function findCloser(text: string, from: number, char: string, size: number): number {
  let index = from
  while (index < text.length) {
    const current = text[index]
    if (current === '\\') {
      index += 2
      continue
    }
    if (current === '`') {
      const span = codeSpanEnd(text, index)
      index = span ? span[1] : index + runLength(text, index, '`')
      continue
    }
    if (current === char) {
      const run = runLength(text, index, char)
      const before = text[index - 1] ?? ''
      const after = text[index + run] ?? ''
      if (
        run === size &&
        index > from &&
        !/\s/.test(before) &&
        (char !== '_' || !WORD_CHAR.test(after))
      ) {
        return index
      }
      index += run
      continue
    }
    index += 1
  }
  return -1
}

function readEmphasis(text: string, at: number): { node: NeProseInline; end: number } | null {
  const char = text[at] ?? ''
  const run = runLength(text, at, char)
  const after = text[at + run] ?? ''
  const before = text[at - 1] ?? ''
  if (run > 3 || after === '' || /\s/.test(after)) return null
  if (char === '_' && WORD_CHAR.test(before)) return null
  const close = findCloser(text, at + run, char, run)
  if (close === -1) return null
  const children = parseInline(text.slice(at + run, close))
  const node: NeProseInline =
    run === 1
      ? { type: 'em', children }
      : run === 2
        ? { type: 'strong', children }
        : { type: 'em', children: [{ type: 'strong', children }] }
  return { node, end: close + run }
}

/** Trim a bare URL's trailing punctuation and any unbalanced closing paren. */
function trimBareUrl(url: string): string {
  let out = url
  for (;;) {
    const trimmed = out.replace(/[?!.,:;*_~'"]+$/, '')
    if (trimmed.endsWith(')')) {
      const opens = trimmed.split('(').length
      const closes = trimmed.split(')').length
      if (closes > opens) {
        out = trimmed.slice(0, -1)
        continue
      }
    }
    return trimmed
  }
}

/** Parse inline markdown into runs. Adjacent text is merged into one run. */
export function parseInline(text: string): NeProseInline[] {
  const out: NeProseInline[] = []
  let buffer = ''
  const flush = () => {
    pushText(out, buffer)
    buffer = ''
  }
  let index = 0

  while (index < text.length) {
    const char = text[index] ?? ''

    if (char === '\\') {
      const next = text[index + 1] ?? ''
      if (next === '\n') {
        flush()
        out.push({ type: 'break' })
        index += 2
        while (text[index] === ' ') index += 1
      } else if (ESCAPABLE.test(next)) {
        buffer += next
        index += 2
      } else {
        buffer += char
        index += 1
      }
      continue
    }

    if (char === '\n') {
      const trailing = /( *)$/.exec(buffer)?.[1] ?? ''
      buffer = buffer.slice(0, buffer.length - trailing.length)
      if (trailing.length >= 2) {
        flush()
        out.push({ type: 'break' })
      } else buffer += '\n'
      index += 1
      while (text[index] === ' ') index += 1
      continue
    }

    if (char === '`') {
      const span = codeSpanEnd(text, index)
      const open = runLength(text, index, '`')
      if (!span) {
        buffer += '`'.repeat(open)
        index += open
        continue
      }
      let value = text.slice(index + open, span[0]).replaceAll('\n', ' ')
      if (value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
        value = value.slice(1, -1)
      }
      flush()
      out.push({ type: 'code', value })
      index = span[1]
      continue
    }

    if (char === '!' && text[index + 1] === '[') {
      const image = readLink(text, index + 1)
      if (image) {
        // Images are out of the subset: the alt text stands in for one.
        buffer += prosePlainText(parseInline(image.text))
        index = image.end
        continue
      }
    }

    if (char === '[') {
      const link = readLink(text, index)
      if (link) {
        const children = parseInline(link.text)
        const href = safeProseHref(link.destination)
        flush()
        if (href === null) pushAll(out, children)
        else out.push({ type: 'link', href, children })
        index = link.end
        continue
      }
    }

    if (char === '<') {
      URI_AUTOLINK.lastIndex = index
      EMAIL_AUTOLINK.lastIndex = index
      const uri = URI_AUTOLINK.exec(text)
      const email = uri ? null : EMAIL_AUTOLINK.exec(text)
      const match = uri ?? email
      if (match) {
        const label = match[1] ?? ''
        const href = safeProseHref(uri ? label : `mailto:${label}`)
        if (href === null) buffer += match[0]
        else {
          flush()
          out.push({ type: 'link', href, children: [{ type: 'text', value: label }] })
        }
        index += match[0].length
        continue
      }
    }

    if ((char === 'h' || char === 'H') && !WORD_CHAR.test(text[index - 1] ?? '')) {
      BARE_URL.lastIndex = index
      const match = BARE_URL.exec(text)
      if (match) {
        const url = trimBareUrl(match[0])
        if (/^https?:\/\/[^/?#]/i.test(url)) {
          flush()
          out.push({ type: 'link', href: url, children: [{ type: 'text', value: url }] })
          index += url.length
          continue
        }
      }
    }

    if (char === '*' || char === '_') {
      const emphasis = readEmphasis(text, index)
      if (emphasis) {
        flush()
        out.push(emphasis.node)
        index = emphasis.end
        continue
      }
      const run = runLength(text, index, char)
      buffer += char.repeat(run)
      index += run
      continue
    }

    buffer += char
    index += 1
  }

  flush()
  return out
}
