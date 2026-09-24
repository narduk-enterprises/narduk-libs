/**
 * Tag-based E2E quarantine (narduk-libs#520).
 *
 * A flake leaves the PR gate with Playwright's `@quarantine` tag, not
 * `test.skip` and not `test.fixme`. The preset's `pr` / `web` projects set
 * `grepInvert` to this tag so a tagged spec is not collected there; the
 * `quarantine` project sets `grep` so the same spec still has a home.
 *
 * {@link assertPlaywrightQuarantineCollection} is the vitest guard: feed it
 * what Playwright actually collected (`playwright test --list`) so an
 * untagged test in `quarantine` or a tagged test in `pr` fails the unit
 * suite instead of a later CI surprise. `{ tag: '@quarantine' }` does not
 * appear in the default `--list` title — pass `readSource` (scoped to the
 * listed `file:line:col`) or JSON list output that carries `tags`.
 */

export const QUARANTINE_TAG = '@quarantine'
export const QUARANTINE_PROJECT_NAME = 'quarantine'
export const QUARANTINE_GREP = /@quarantine/

export const GATE_PROJECT_NAMES = ['pr', 'web', 'chromium'] as const

export interface QuarantineDetails {
  date: string
  issue: string
  owner: string
}

export interface QuarantineTestDetails {
  annotation: Array<{ description: string; type: 'issue' }>
  tag: typeof QUARANTINE_TAG
}

export interface CollectedPlaywrightTest {
  column?: number
  file: string
  line?: number
  project: string
  tags?: readonly string[]
  title?: string
}

export interface PlaywrightQuarantineCollectionOptions {
  collected: readonly CollectedPlaywrightTest[]
  /**
   * File path (or a suffix of the listed path) → source. Used when the
   * `--list` title does not repeat `{ tag: '@quarantine' }`. The check is
   * scoped to the listed test at `line`, so one quarantined test does not
   * quarantine its siblings.
   */
  sources?: Readonly<Record<string, string>>
  readSource?: (file: string) => string
}

const FILE_LINE_COL = /:(\d+):(\d+)$/

const TEST_CALL_PREFIXES = [
  'test(',
  'test.only(',
  'test.fixme(',
  'test.skip(',
  'test.describe(',
  'test.describe.only(',
  'test.describe.serial(',
  'test.describe.parallel(',
] as const

export function isGateProjectName(projectName: string): boolean {
  return (GATE_PROJECT_NAMES as readonly string[]).includes(projectName)
}

export function isQuarantineProjectName(projectName: string): boolean {
  return projectName === QUARANTINE_PROJECT_NAME
}

export function titleDeclaresQuarantineTag(title: string): boolean {
  return title.includes(QUARANTINE_TAG)
}

export function sourceDeclaresQuarantineTag(source: string): boolean {
  if (source.includes('quarantineDetails(')) return true
  if (source.includes('tag: QUARANTINE_TAG') || source.includes('tags: [QUARANTINE_TAG]')) {
    return true
  }
  if (source.includes(`tag: '${QUARANTINE_TAG}'`) || source.includes(`tag: "${QUARANTINE_TAG}"`)) {
    return true
  }
  if (
    source.includes(`tags: ['${QUARANTINE_TAG}']`) ||
    source.includes(`tags: ["${QUARANTINE_TAG}"]`)
  ) {
    return true
  }
  return callTitleDeclaresQuarantineTag(source)
}

/**
 * The `test(` / `test.describe(` call that contains `line` (1-based), or
 * `undefined` when the line is missing so a whole-file tag cannot leak onto
 * a sibling.
 */
export function testSourceAtLine(source: string, line?: number): string | undefined {
  if (line === undefined || line < 1) return undefined
  const lines = source.split(/\r?\n/)
  const start = findTestCallStartIndex(lines, line - 1)
  if (start === -1) return undefined
  return collectBalancedCall(lines, start)
}

export function collectedTestDeclaresQuarantine(
  entry: CollectedPlaywrightTest,
  source?: string,
): boolean {
  if (entry.tags?.some((tag) => tag === QUARANTINE_TAG || tag === 'quarantine')) {
    return true
  }
  if (entry.title !== undefined && titleDeclaresQuarantineTag(entry.title)) {
    return true
  }
  if (source === undefined) return false
  const snippet = testSourceAtLine(source, entry.line)
  if (snippet === undefined) return false
  return sourceDeclaresQuarantineTag(snippet)
}

/**
 * Playwright `test(title, details, body)` details object. The description
 * is `<issue> -- <date> -- <owner>`, the same order the generator's flake
 * policy already documents. A quarantine with no issue is not a quarantine.
 */
export function quarantineDetails(meta: QuarantineDetails): QuarantineTestDetails {
  const issue = meta.issue.trim()
  const date = meta.date.trim()
  const owner = meta.owner.trim()
  if (!issue) {
    throw new Error(
      'A quarantine with no issue is not a quarantine, it is a deleted test with extra steps (narduk-libs#520).',
    )
  }
  if (!date || !owner) {
    throw new Error('quarantineDetails requires issue, date, and owner (narduk-libs#520).')
  }
  return {
    tag: QUARANTINE_TAG,
    annotation: [{ type: 'issue', description: `${issue} -- ${date} -- ${owner}` }],
  }
}

export function parsePlaywrightListOutput(listed: string): CollectedPlaywrightTest[] {
  const fromJson = tryParsePlaywrightJson(listed)
  if (fromJson) return fromJson

  const collected: CollectedPlaywrightTest[] = []
  for (const rawLine of listed.split(/\r?\n/)) {
    const parsed = parsePlaywrightListLine(rawLine)
    if (parsed) collected.push(parsed)
  }
  return collected
}

export function parsePlaywrightJsonList(report: unknown): CollectedPlaywrightTest[] {
  if (!isJsonReport(report)) return []
  const collected: CollectedPlaywrightTest[] = []
  walkJsonSuites(report.suites, collected)
  return collected
}

function tryParsePlaywrightJson(listed: string): CollectedPlaywrightTest[] | undefined {
  const trimmed = listed.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1))
    if (!isJsonReport(value)) return undefined
    return parsePlaywrightJsonList(value)
  } catch {
    return undefined
  }
}

function isJsonReport(value: unknown): value is { suites: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { suites?: unknown }).suites)
  )
}

function walkJsonSuites(suites: unknown[], collected: CollectedPlaywrightTest[]): void {
  for (const suite of suites) {
    if (!suite || typeof suite !== 'object') continue
    const record = suite as { specs?: unknown[]; suites?: unknown[] }
    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) walkJsonSpec(spec, collected)
    }
    if (Array.isArray(record.suites)) walkJsonSuites(record.suites, collected)
  }
}

function walkJsonSpec(spec: unknown, collected: CollectedPlaywrightTest[]): void {
  if (!spec || typeof spec !== 'object') return
  const record = spec as {
    column?: unknown
    file?: unknown
    line?: unknown
    tags?: unknown
    tests?: unknown[]
    title?: unknown
  }
  if (typeof record.file !== 'string') return
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string')
    : undefined
  const title = typeof record.title === 'string' ? record.title : undefined
  const line = typeof record.line === 'number' ? record.line : undefined
  const column = typeof record.column === 'number' ? record.column : undefined
  const tests = Array.isArray(record.tests) ? record.tests : []
  for (const test of tests) {
    if (!test || typeof test !== 'object') continue
    const project = (test as { projectName?: unknown }).projectName
    if (typeof project !== 'string' || project.length === 0) continue
    collected.push({
      file: record.file,
      project,
      ...(title === undefined ? {} : { title }),
      ...(tags && tags.length > 0 ? { tags } : {}),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    })
  }
}

function parsePlaywrightListLine(rawLine: string): CollectedPlaywrightTest | undefined {
  const line = rawLine.trim()
  if (!line.startsWith('[')) return undefined
  const close = line.indexOf(']')
  if (close <= 1) return undefined
  const project = line.slice(1, close)
  const rest = line.slice(close + 1).trim()
  const marker = rest.startsWith('›') ? '›' : rest.startsWith('>') ? '>' : ''
  if (!marker || !project) return undefined

  const afterProject = rest.slice(marker.length).trim()
  const titleSep = afterProject.includes('›')
    ? afterProject.indexOf('›')
    : afterProject.includes(' > ')
      ? afterProject.indexOf(' > ')
      : -1
  const filePart = (titleSep === -1 ? afterProject : afterProject.slice(0, titleSep)).trim()
  const title = titleSep === -1 ? undefined : stripListSeparator(afterProject.slice(titleSep))
  const location = FILE_LINE_COL.exec(filePart)
  const file = filePart.replace(FILE_LINE_COL, '')
  if (!file) return undefined
  const tags = title ? tagsFromTitle(title) : undefined
  return {
    file,
    project,
    ...(title === undefined ? {} : { title }),
    ...(tags ? { tags } : {}),
    ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}),
  }
}

function tagsFromTitle(title: string): string[] | undefined {
  const tags: string[] = []
  for (const token of title.split(' ')) {
    if (token.startsWith('@') && token.length > 1) tags.push(token)
  }
  return tags.length > 0 ? tags : undefined
}

export function assertPlaywrightQuarantineCollection(
  options: PlaywrightQuarantineCollectionOptions,
): void {
  const untagged: CollectedPlaywrightTest[] = []
  const wronglyTagged: CollectedPlaywrightTest[] = []

  for (const entry of options.collected) {
    if (!isGateProjectName(entry.project) && !isQuarantineProjectName(entry.project)) {
      continue
    }
    const tagged = collectedTestDeclaresQuarantine(entry, sourceFor(entry.file, options))
    if (isQuarantineProjectName(entry.project) && !tagged) {
      untagged.push(entry)
    }
    if (isGateProjectName(entry.project) && tagged) {
      wronglyTagged.push(entry)
    }
  }

  if (untagged.length === 0 && wronglyTagged.length === 0) return

  const lines = [
    'Playwright collected a test the @quarantine tag does not explain (narduk-libs#520).',
  ]
  if (untagged.length > 0) {
    lines.push('Untagged test collected by the quarantine project:')
    for (const entry of untagged) lines.push(`  [${entry.project}] ${entry.file}${suffix(entry)}`)
  }
  if (wronglyTagged.length > 0) {
    lines.push('Wrongly tagged test collected by a PR/web project:')
    for (const entry of wronglyTagged) {
      lines.push(`  [${entry.project}] ${entry.file}${suffix(entry)}`)
    }
  }
  throw new Error(lines.join('\n'))
}

function suffix(entry: CollectedPlaywrightTest): string {
  return entry.title ? ` › ${entry.title}` : ''
}

function stripListSeparator(value: string): string {
  let index = 0
  while (index < value.length) {
    const char = value[index]
    if (char === '›' || char === '>' || char === ' ' || char === '\t') {
      index += 1
      continue
    }
    break
  }
  return value.slice(index).trim()
}

function sourceFor(
  file: string,
  options: PlaywrightQuarantineCollectionOptions,
): string | undefined {
  if (options.sources) {
    const exact = options.sources[file]
    if (exact !== undefined) return exact
    const normalized = file.replaceAll('\\', '/')
    for (const [key, value] of Object.entries(options.sources)) {
      const candidate = key.replaceAll('\\', '/')
      if (normalized.endsWith(candidate) || candidate.endsWith(normalized)) return value
    }
  }
  if (!options.readSource) return undefined
  try {
    return options.readSource(file)
  } catch {
    return undefined
  }
}

function callTitleDeclaresQuarantineTag(source: string): boolean {
  const open = source.indexOf('(')
  if (open === -1) return false
  const rest = source.slice(open + 1).trimStart()
  const quote = rest[0]
  if (quote !== "'" && quote !== '"' && quote !== '`') return false
  let index = 1
  while (index < rest.length) {
    const char = rest[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) break
    index += 1
  }
  return rest.slice(1, index).includes(QUARANTINE_TAG)
}

function isTestCallStart(line: string): boolean {
  const trimmed = line.trimStart()
  for (const prefix of TEST_CALL_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }
  return false
}

function findTestCallStartIndex(lines: readonly string[], fromIndex: number): number {
  const last = Math.min(fromIndex, lines.length - 1)
  for (let index = last; index >= 0; index -= 1) {
    if (isTestCallStart(lines[index] ?? '')) return index
  }
  return -1
}

function collectBalancedCall(lines: readonly string[], start: number): string {
  const from = lines.slice(start).join('\n')
  const open = from.indexOf('(')
  if (open === -1) return lines[start] ?? ''

  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTemplate = false
  let inLineComment = false
  let inBlockComment = false
  let escape = false

  for (let index = open; index < from.length; index += 1) {
    const char = from[index]
    const next = from[index + 1]
    if (char === undefined) break

    if (inLineComment) {
      if (char === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }
    if (inSingle || inDouble || inTemplate) {
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if (inSingle && char === "'") inSingle = false
      if (inDouble && char === '"') inDouble = false
      if (inTemplate && char === '`') inTemplate = false
      continue
    }
    if (char === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }
    if (char === "'") {
      inSingle = true
      continue
    }
    if (char === '"') {
      inDouble = true
      continue
    }
    if (char === '`') {
      inTemplate = true
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return from.slice(0, index + 1)
    }
  }
  return from
}
