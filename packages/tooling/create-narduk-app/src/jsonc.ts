/**
 * A dependency-free JSONC scanner for the one wrangler key upgrade writes
 * (narduk-libs#672). It is string-aware: `//`, `/*` and `,` inside a JSON
 * string -- a route `pattern` such as `"edge.example.com/*"`, a `**\/*.mjs`
 * glob, a URL -- are string content, never a comment or a trailing comma.
 */

export interface JsoncToken {
  /** `punct` is one of `{ } [ ] : ,`; `literal` is a number, `true`, `false` or `null`. */
  kind: 'literal' | 'punct' | 'string'
  /** Offset of the token's first character. */
  start: number
  /** Offset just past the token's last character. */
  end: number
  text: string
}

export interface JsoncScan {
  tokens: JsoncToken[]
  /** `[start, end)` of every `//` and `/* *\/` comment, in order. */
  comments: Array<{ start: number; end: number }>
  /** False when a string or block comment is unterminated. */
  complete: boolean
}

const PUNCTUATION = new Set(['{', '}', '[', ']', ':', ','])

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

function startsComment(text: string, index: number): boolean {
  return text[index] === '/' && (text[index + 1] === '/' || text[index + 1] === '*')
}

/** End offset of the string opening at `start`, and whether it closed on its own line. */
function scanString(text: string, start: number): { end: number; closed: boolean } {
  let index = start + 1
  while (index < text.length) {
    const character = text[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '"') return { closed: true, end: index + 1 }
    if (character === '\n') return { closed: false, end: index }
    index += 1
  }
  return { closed: false, end: text.length }
}

export function scanJsonc(text: string): JsoncScan {
  const tokens: JsoncToken[] = []
  const comments: Array<{ start: number; end: number }> = []
  let complete = true
  let index = 0
  while (index < text.length) {
    const character = text[index] as string
    if (isWhitespace(character)) {
      index += 1
    } else if (character === '"') {
      const string = scanString(text, index)
      if (!string.closed) complete = false
      tokens.push({
        end: string.end,
        kind: 'string',
        start: index,
        text: text.slice(index, string.end),
      })
      index = string.end
    } else if (text.startsWith('//', index)) {
      const newline = text.indexOf('\n', index)
      const end = newline === -1 ? text.length : newline
      comments.push({ end, start: index })
      index = end
    } else if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2)
      if (close === -1) complete = false
      const end = close === -1 ? text.length : close + 2
      comments.push({ end, start: index })
      index = end
    } else if (PUNCTUATION.has(character)) {
      tokens.push({ end: index + 1, kind: 'punct', start: index, text: character })
      index += 1
    } else {
      let end = index + 1
      while (
        end < text.length &&
        !isWhitespace(text[end] as string) &&
        !PUNCTUATION.has(text[end] as string) &&
        text[end] !== '"' &&
        !startsComment(text, end)
      ) {
        end += 1
      }
      tokens.push({ end, kind: 'literal', start: index, text: text.slice(index, end) })
      index = end
    }
  }
  return { comments, complete, tokens }
}

/**
 * Removes comments and trailing commas outside strings, so the result is
 * JSON that `JSON.parse` reads the way wrangler reads the JSONC. Everything
 * else, string contents included, is kept byte for byte.
 */
export function stripJsonc(text: string): string {
  const { comments, tokens } = scanJsonc(text)
  const dropped: Array<{ start: number; end: number; replacement: string }> = comments.map(
    // A block comment still separates the tokens on either side of it.
    (comment) => ({ ...comment, replacement: text[comment.start + 1] === '*' ? ' ' : '' }),
  )
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as JsoncToken
    const next = tokens[index + 1] as JsoncToken
    if (token.text === ',' && token.kind === 'punct' && (next.text === '}' || next.text === ']')) {
      dropped.push({ end: token.end, replacement: '', start: token.start })
    }
  }
  dropped.sort((left, right) => left.start - right.start)
  let result = ''
  let cursor = 0
  for (const range of dropped) {
    result += text.slice(cursor, range.start) + range.replacement
    cursor = range.end
  }
  return result + text.slice(cursor)
}

/** Parses JSONC whose top level is an object; `null` for anything else. */
export function parseJsoncObject(contents: string | null): Record<string, unknown> | null {
  if (contents === null || !scanJsonc(contents).complete) return null
  try {
    const parsed: unknown = JSON.parse(stripJsonc(contents))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Finds a key of the top-level object -- never a same-named key nested in
 * `env.<name>` or anywhere else -- and returns the offsets of its value.
 * `null` when the key is absent or the top level is not an object.
 */
export function findTopLevelValue(
  tokens: readonly JsoncToken[],
  key: string,
): { start: number; end: number } | null {
  if (tokens[0]?.text !== '{') return null
  let depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as JsoncToken
    if (token.kind === 'punct') {
      if (token.text === '{' || token.text === '[') depth += 1
      else if (token.text === '}' || token.text === ']') depth -= 1
      continue
    }
    const previous = tokens[index - 1]?.text
    if (
      depth !== 1 ||
      token.kind !== 'string' ||
      tokens[index + 1]?.text !== ':' ||
      (previous !== '{' && previous !== ',') ||
      decodeString(token.text) !== key
    ) {
      continue
    }
    const first = tokens[index + 2]
    if (!first) return null
    let nested = 0
    for (let valueIndex = index + 2; valueIndex < tokens.length; valueIndex += 1) {
      const value = tokens[valueIndex] as JsoncToken
      if (value.kind === 'punct' && (value.text === '{' || value.text === '[')) nested += 1
      else if (value.kind === 'punct' && (value.text === '}' || value.text === ']')) nested -= 1
      if (nested === 0) return { end: value.end, start: first.start }
    }
    return null
  }
  return null
}

function decodeString(literal: string): string | null {
  try {
    const decoded: unknown = JSON.parse(literal)
    return typeof decoded === 'string' ? decoded : null
  } catch {
    return null
  }
}
