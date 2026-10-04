import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/**
 * Per-page `<lastmod>` for the @nuxtjs/sitemap page source (narduk-libs#1414).
 *
 * Sources, most authoritative first:
 * 1. `definePageMeta({ sitemap: { lastmod } })` — left untouched.
 * 2. A literal `modifiedAt` in the page's `useSeo()` call, so the sitemap agrees
 *    with the `article:modified_time` the page itself emits.
 * 3. The page file's last commit date, from one `git log` for every page.
 *
 * Never the build or request time: upstream `autoLastmod` stamps file mtimes
 * (checkout time on CI) and defaults to `new Date()`, so every URL would carry
 * the same date and search engines would learn to ignore it. A shallow clone
 * reports HEAD's date for every file, so it is skipped for the same reason.
 * With no trustworthy source the page gets no `<lastmod>` at all.
 */

export interface SitemapLastmodPage {
  children?: SitemapLastmodPage[]
  file?: string
  meta?: Record<string, unknown>
}

export interface GitLastmodResult {
  dates: Map<string, string>
  /** Why git dates are unavailable, for one build log line. */
  skipped?: 'not-a-repository' | 'shallow-clone'
}

const MODIFIED_AT_LITERAL = /\bmodifiedAt\s*:\s*(['"`])([^'"`$\n]+)\1/

export function toIsoDate(value: string): string | undefined {
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/** The literal `modifiedAt: '…'` in a page's source, as ISO; undefined if absent or invalid. */
export function readSeoModifiedAt(source: string): string | undefined {
  const match = MODIFIED_AT_LITERAL.exec(source)
  return match?.[2] ? toIsoDate(match[2]) : undefined
}

/**
 * Parse `git log --format=%x00%cI --name-only` output: each commit is a NUL,
 * its committer date, then the files it touched. Log order is newest first,
 * so the first date seen for a path is its last change.
 */
export function parseGitLogNameOnly(output: string, topLevel: string): Map<string, string> {
  const dates = new Map<string, string>()
  for (const block of output.split('\0')) {
    const [rawDate, ...files] = block.split('\n')
    const date = rawDate ? toIsoDate(rawDate.trim()) : undefined
    if (!date) continue
    for (const file of files) {
      const path = file.trim()
      if (!path) continue
      const absolute = resolve(topLevel, path)
      if (!dates.has(absolute)) dates.set(absolute, date)
    }
  }
  return dates
}

type RunGit = (args: string[], cwd: string) => string

const runGit: RunGit = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

/** Last commit date per file, from a single `git log` over every given file. */
export function gitLastCommitDates(
  files: string[],
  cwd: string,
  git: RunGit = runGit,
): GitLastmodResult {
  let topLevel: string
  let shallow: string
  try {
    ;[topLevel = '', shallow = ''] = git(
      ['rev-parse', '--show-toplevel', '--is-shallow-repository'],
      cwd,
    )
      .trim()
      .split('\n')
  } catch {
    return { dates: new Map(), skipped: 'not-a-repository' }
  }
  if (!topLevel) return { dates: new Map(), skipped: 'not-a-repository' }
  if (shallow.trim() === 'true') return { dates: new Map(), skipped: 'shallow-clone' }

  // Layer and package pages live outside the app's history; git refuses paths outside the repo.
  const inside = files
    .map((file) => relative(topLevel, file))
    .filter((path) => path && !path.startsWith('..') && !path.split(sep).includes('node_modules'))
  if (inside.length === 0) return { dates: new Map() }

  try {
    const output = git(['log', '--format=%x00%cI', '--name-only', '--', ...inside], topLevel)
    return { dates: parseGitLogNameOnly(output, topLevel) }
  } catch {
    return { dates: new Map(), skipped: 'not-a-repository' }
  }
}

function flattenPages(pages: SitemapLastmodPage[], out: SitemapLastmodPage[] = []) {
  for (const page of pages) {
    out.push(page)
    if (page.children?.length) flattenPages(page.children, out)
  }
  return out
}

function hasOwnLastmod(page: SitemapLastmodPage): boolean {
  const sitemap = page.meta?.sitemap
  if (sitemap === false) return true
  return Boolean(sitemap && typeof sitemap === 'object' && 'lastmod' in sitemap)
}

export interface ApplySitemapLastmodOptions {
  cwd: string
  git?: RunGit
  readSource?: (file: string) => string | undefined
}

export interface ApplySitemapLastmodResult {
  fromGit: number
  fromSeo: number
  skipped?: GitLastmodResult['skipped']
}

const readSourceFile = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** Set `meta.sitemap.lastmod` on every page that lacks one and has a trustworthy date. */
export function applySitemapLastmod(
  pages: SitemapLastmodPage[],
  options: ApplySitemapLastmodOptions,
): ApplySitemapLastmodResult {
  const readSource = options.readSource ?? readSourceFile
  const pending = flattenPages(pages).filter((page) => page.file && !hasOwnLastmod(page))
  const result: ApplySitemapLastmodResult = { fromGit: 0, fromSeo: 0 }

  const needGit: SitemapLastmodPage[] = []
  for (const page of pending) {
    const source = readSource(page.file!)
    const modifiedAt = source ? readSeoModifiedAt(source) : undefined
    if (modifiedAt) {
      setLastmod(page, modifiedAt)
      result.fromSeo++
    } else {
      needGit.push(page)
    }
  }
  if (needGit.length === 0) return result

  const git = gitLastCommitDates(
    needGit.map((page) => resolve(page.file!)),
    options.cwd,
    options.git,
  )
  result.skipped = git.skipped
  for (const page of needGit) {
    const date = git.dates.get(resolve(page.file!))
    if (date) {
      setLastmod(page, date)
      result.fromGit++
    }
  }
  return result
}

function setLastmod(page: SitemapLastmodPage, lastmod: string): void {
  const sitemap = page.meta?.sitemap
  page.meta = {
    ...page.meta,
    sitemap: { ...(sitemap && typeof sitemap === 'object' ? sitemap : {}), lastmod },
  }
}
