import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { Journey } from './types.js'

/**
 * The declaration digest (spec 4.2): a hash of the catalog's SOURCE, because
 * the executable step bodies are part of the declaration - a prose-only
 * projection would call two behaviourally different catalogs identical. Files
 * are hashed as sorted (relative path, content) pairs so the digest is stable
 * across traversal order and machines.
 */
export function digestFiles(files: ReadonlyMap<string, Buffer | string>): string {
  const hash = createHash('sha256')
  const separator = Buffer.from([0])
  for (const path of [...files.keys()].sort()) {
    const content = files.get(path)
    if (content === undefined) continue
    hash.update(path)
    hash.update(separator)
    hash.update(content)
    hash.update(separator)
  }
  return `sha256:${hash.digest('hex')}`
}

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.journeys'])

/**
 * Digest every regular file under a catalog directory, whatever its size.
 *
 * There is no size cap: a file the walk skipped could change without moving
 * the digest, so evidence captured under the old declaration would still
 * verify (narduk-libs#118). Reading a few megabytes costs nothing next to the
 * browser run the digest gates.
 */
export function digestDirectory(root: string): string {
  const files = new Map<string, Buffer>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        files.set(relative(root, full), readFileSync(full))
      }
    }
  }
  walk(root)
  return digestFiles(files)
}

/** A `/` after one of these opens a regular expression, not a division. */
const REGEX_AFTER_PUNCTUATOR = new Set('(,=:[!&|?{};+-*%<>~^')
const REGEX_AFTER_KEYWORD =
  /\b(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)$/u

/** End of the quoted string opening at `start`, past its closing quote. */
function quotedEnd(source: string, start: number): number {
  const quote = source[start]
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') index += 1
    else if (char === quote || char === '\n') return index + 1
  }
  return source.length
}

/** Past the next backtick, or past the next `${`, scanning template text. */
function templateEnd(source: string, start: number): { end: number; opensExpression: boolean } {
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') index += 1
    else if (char === '`') return { end: index + 1, opensExpression: false }
    else if (char === '$' && source[index + 1] === '{') {
      return { end: index + 2, opensExpression: true }
    }
  }
  return { end: source.length, opensExpression: false }
}

/** End of the regular expression opening at `start`, or -1 when it is a division. */
function regexEnd(source: string, start: number): number {
  let inClass = false
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\n') return -1
    if (char === '\\') index += 1
    else if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) {
      let end = index + 1
      while (end < source.length && /[a-z]/iu.test(source[end] as string)) end += 1
      return end
    }
  }
  return -1
}

/**
 * Capture (Playwright) and verify (plain Node / Vitest) pretty-print the
 * same function differently: ASI semicolons, indent, and object literals
 * broken across lines. Collapse that so the digest is about the body, not
 * the loader (narduk-libs#66).
 *
 * Only in code, though. String, template and regex literals are the values a
 * step types and matches, and no loader re-prints them, so they are kept
 * verbatim: `'a;b'` and `'ab'` are different journeys (#882). A body whose
 * literals hold no `;` and no whitespace but single spaces digests exactly as
 * before.
 */
function normalizeFunctionSource(source: string): string {
  let normalized = ''
  let code = ''
  // Code seen since the last literal, kept whole so a regex can be told from
  // a division by what precedes it.
  let recent = ''
  let braces = 0
  const templateBraces: number[] = []
  const takeLiteral = (start: number, end: number): number => {
    normalized += code.replaceAll(/\s+/gu, ' ').replaceAll(';', '') + source.slice(start, end)
    code = ''
    recent = 'x'
    return end
  }
  let index = 0
  while (index < source.length) {
    const char = source[index] as string
    const next = source[index + 1]
    if (char === '/' && (next === '/' || next === '*')) {
      const close = next === '/' ? source.indexOf('\n', index) : source.indexOf('*/', index + 2)
      const end = close === -1 ? source.length : next === '/' ? close : close + 2
      code += source.slice(index, end)
      index = end
    } else if (char === "'" || char === '"') {
      index = takeLiteral(index, quotedEnd(source, index))
    } else if (char === '`' || (char === '}' && templateBraces.at(-1) === braces)) {
      if (char === '}') templateBraces.pop()
      const template = templateEnd(source, index + 1)
      index = takeLiteral(index, template.end)
      if (template.opensExpression) {
        templateBraces.push(braces)
        recent = '{'
      }
    } else if (char === '/') {
      const before = recent.trimEnd()
      const opensRegex =
        before === '' ||
        REGEX_AFTER_PUNCTUATOR.has(before.at(-1) as string) ||
        REGEX_AFTER_KEYWORD.test(before)
      const end = opensRegex ? regexEnd(source, index) : -1
      if (end === -1) {
        code += char
        recent += char
        index += 1
      } else {
        index = takeLiteral(index, end)
      }
    } else {
      if (char === '{') braces += 1
      if (char === '}') braces -= 1
      code += char
      recent += char
      index += 1
    }
  }
  normalized += code.replaceAll(/\s+/gu, ' ').replaceAll(';', '')
  return normalized.trim()
}

function functionSource(value: unknown): string | null {
  return typeof value === 'function' ? normalizeFunctionSource(value.toString()) : null
}

/**
 * The digest of ONE journey's declared shape, including executable step
 * bodies (`do` / `appliesIf` source, normalized so Playwright and Node
 * agree). Sibling journeys and other files under the catalog directory are
 * not part of this hash, so adding journey N+1 does not invalidate a
 * promoted capture of journey N (narduk-libs#66).
 *
 * Shared helpers a step *calls* are the honest gap: a change inside an
 * imported function does not move this digest unless the step's own source
 * changes. Hashing the module graph would close that and re-introduce a
 * file-layout dependency this form is designed not to have.
 */
export function digestJourney(journey: Journey): string {
  const record: Record<string, unknown> = {
    id: journey.id,
    title: journey.title,
    surface: journey.surface,
    role: journey.role,
    scenarios: [...journey.scenarios],
    outcome: journey.outcome,
    tags: journey.tags ?? null,
    compromises: journey.compromises ?? null,
    steps: journey.steps.map((step) => {
      const entry: Record<string, unknown> = {
        id: step.id,
        say: step.say,
        skipWhen: step.skipWhen ?? null,
        capture: step.capture ?? null,
      }
      if ('do' in step) {
        entry.do = functionSource(step.do)
        entry.appliesIf = functionSource(step.appliesIf)
      }
      if ('press' in step) {
        entry.press = step.press
        entry.lands = step.lands
      }
      return entry
    }),
  }
  if (journey.surface !== 'web') {
    record.drive = journey.drive ?? 'xctest'
    if (journey.drive === 'driven') {
      record.launchArgs = journey.launchArgs
      record.start = journey.start
    } else {
      record.binding = journey.binding
    }
  }
  return digestFiles(new Map([[`journey:${journey.id}`, JSON.stringify(record)]]))
}
