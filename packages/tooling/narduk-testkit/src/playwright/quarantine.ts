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
 * untagged file in `quarantine` or a tagged file in `pr` fails the unit
 * suite instead of a later CI surprise.
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
  file: string
  project: string
  tags?: readonly string[]
  title?: string
}

export interface PlaywrightQuarantineCollectionOptions {
  collected: readonly CollectedPlaywrightTest[]
  /**
   * File path (or a suffix of the listed path) → source. Used when the
   * `--list` title does not repeat `{ tag: '@quarantine' }`.
   */
  sources?: Readonly<Record<string, string>>
  readSource?: (file: string) => string
}

const FILE_LINE_COL = /:\d+:\d+$/

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
  return (
    source.includes(QUARANTINE_TAG) ||
    source.includes('quarantineDetails(') ||
    source.includes('QUARANTINE_TAG')
  )
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
  if (source !== undefined) return sourceDeclaresQuarantineTag(source)
  return false
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
  const collected: CollectedPlaywrightTest[] = []
  for (const rawLine of listed.split(/\r?\n/)) {
    const parsed = parsePlaywrightListLine(rawLine)
    if (parsed) collected.push(parsed)
  }
  return collected
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
  const file = filePart.replace(FILE_LINE_COL, '')
  if (!file) return undefined
  return title ? { file, project, title } : { file, project }
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
    'Playwright collected a file the @quarantine tag does not explain (narduk-libs#520).',
  ]
  if (untagged.length > 0) {
    lines.push('Untagged file collected by the quarantine project:')
    for (const entry of untagged) lines.push(`  [${entry.project}] ${entry.file}${suffix(entry)}`)
  }
  if (wronglyTagged.length > 0) {
    lines.push('Wrongly tagged file collected by a PR/web project:')
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
