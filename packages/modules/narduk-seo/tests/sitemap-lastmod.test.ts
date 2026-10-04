import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applySitemapLastmod,
  gitLastCommitDates,
  parseGitLogNameOnly,
  readSeoModifiedAt,
  type SitemapLastmodPage,
} from '../src/sitemapLastmod'

const ROOT = '/repo'
const ABOUT = '/repo/app/pages/about.vue'
const GUIDE = '/repo/app/pages/guide.vue'
const HOME = '/repo/app/pages/index.vue'

describe('readSeoModifiedAt', () => {
  it('reads a literal modifiedAt as ISO', () => {
    expect(readSeoModifiedAt(`useSeo({ type: 'article', modifiedAt: '2026-10-04' })`)).toBe(
      '2026-10-04T00:00:00.000Z',
    )
  })

  it('ignores template literals with interpolation and invalid dates', () => {
    expect(readSeoModifiedAt('useSeo({ modifiedAt: `${date}` })')).toBeUndefined()
    expect(readSeoModifiedAt(`useSeo({ modifiedAt: 'not a date' })`)).toBeUndefined()
    expect(readSeoModifiedAt('useSeo({ title: "x" })')).toBeUndefined()
  })
})

describe('parseGitLogNameOnly', () => {
  it('keeps the newest date per file', () => {
    const output =
      '\u00002026-10-04T12:00:00-05:00\n\napp/pages/index.vue\n' +
      '\u00002026-09-01T08:00:00Z\n\napp/pages/index.vue\napp/pages/about.vue\n'
    const dates = parseGitLogNameOnly(output, ROOT)
    expect(dates.get(HOME)).toBe('2026-10-04T17:00:00.000Z')
    expect(dates.get(ABOUT)).toBe('2026-09-01T08:00:00.000Z')
  })
})

describe('gitLastCommitDates', () => {
  it('skips a shallow clone instead of stamping HEAD on every page', () => {
    const calls: string[][] = []
    const result = gitLastCommitDates([HOME], ROOT, (args) => {
      calls.push(args)
      return `${ROOT}\ntrue\n`
    })
    expect(result).toEqual({ dates: new Map(), skipped: 'shallow-clone' })
    expect(calls).toHaveLength(1)
  })

  it('fetches full history on a shallow clone when asked, then reads the log', () => {
    const calls: string[][] = []
    const result = gitLastCommitDates(
      [HOME],
      ROOT,
      (args) => {
        calls.push(args)
        if (args[0] === 'rev-parse' && args.length === 3) return `${ROOT}\ntrue\n`
        if (args[0] === 'fetch') return ''
        if (args[0] === 'rev-parse') return 'false\n'
        return `\0${'2026-10-04T12:00:00-05:00'}\n\napp/pages/index.vue\n`
      },
      true,
    )
    expect(calls.map((c) => c[0])).toEqual(['rev-parse', 'fetch', 'rev-parse', 'log'])
    expect(calls[1]).toEqual(['fetch', '--unshallow', '--quiet'])
    expect(result.skipped).toBeUndefined()
    expect(result.dates.get(HOME)).toBe('2026-10-04T17:00:00.000Z')
  })

  it('stays skipped when the unshallow fetch fails', () => {
    const calls: string[][] = []
    const result = gitLastCommitDates(
      [HOME],
      ROOT,
      (args) => {
        calls.push(args)
        if (args[0] === 'fetch') throw new Error('no network')
        return `${ROOT}\ntrue\n`
      },
      true,
    )
    expect(result).toEqual({ dates: new Map(), skipped: 'shallow-clone' })
    expect(calls.map((c) => c[0])).toEqual(['rev-parse', 'fetch'])
  })

  it('runs one git log for every file inside the repository', () => {
    const calls: string[][] = []
    gitLastCommitDates([HOME, ABOUT, '/elsewhere/layer/page.vue'], ROOT, (args) => {
      calls.push(args)
      return args[0] === 'rev-parse' ? `${ROOT}\nfalse\n` : ''
    })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual([
      'log',
      '--format=%x00%cI',
      '--name-only',
      '--',
      'app/pages/index.vue',
      'app/pages/about.vue',
    ])
  })

  it('reports a missing repository without throwing', () => {
    const result = gitLastCommitDates([HOME], ROOT, () => {
      throw new Error('not a git repository')
    })
    expect(result.skipped).toBe('not-a-repository')
  })
})

describe('applySitemapLastmod', () => {
  const sources: Record<string, string> = {
    [GUIDE]: `useSeo({ modifiedAt: '2026-10-04T00:00:00Z' })`,
    [HOME]: `useSeo({ title: 'Home' })`,
    [ABOUT]: '',
  }
  const git = (args: string[]) =>
    args[0] === 'rev-parse'
      ? `${ROOT}\nfalse\n`
      : '\u00002026-09-30T10:00:00Z\n\napp/pages/index.vue\n'

  it('prefers useSeo modifiedAt, then git, and never invents a date', () => {
    const pages: SitemapLastmodPage[] = [
      { file: GUIDE },
      { file: HOME },
      { file: ABOUT, meta: { title: 'About' } },
    ]
    const result = applySitemapLastmod(pages, {
      cwd: ROOT,
      git,
      readSource: (f) => sources[f],
    })
    expect(pages[0]!.meta).toEqual({ sitemap: { lastmod: '2026-10-04T00:00:00.000Z' } })
    expect(pages[1]!.meta).toEqual({ sitemap: { lastmod: '2026-09-30T10:00:00.000Z' } })
    expect(pages[2]!.meta).toEqual({ title: 'About' })
    expect(result).toEqual({ fromGit: 1, fromSeo: 1, skipped: undefined })
  })

  it('leaves explicit page-meta lastmod, excluded pages and children alone or covered', () => {
    const pages: SitemapLastmodPage[] = [
      { file: GUIDE, meta: { sitemap: { lastmod: '2020-01-01' } } },
      { file: ABOUT, meta: { sitemap: false } },
      { children: [{ file: HOME, meta: { sitemap: { priority: 0.8 } } }] },
    ]
    applySitemapLastmod(pages, { cwd: ROOT, git, readSource: (f) => sources[f] })
    expect(pages[0]!.meta).toEqual({ sitemap: { lastmod: '2020-01-01' } })
    expect(pages[1]!.meta).toEqual({ sitemap: false })
    expect(pages[2]!.children![0]!.meta).toEqual({
      sitemap: { priority: 0.8, lastmod: '2026-09-30T10:00:00.000Z' },
    })
  })
})

describe('gitLastCommitDates against a real repository', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('returns each file its own commit date', () => {
    dir = mkdtempSync(join(tmpdir(), 'narduk-seo-lastmod-'))
    const run = (args: string[], date: string) =>
      execFileSync('git', args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@example.com',
        },
        stdio: 'ignore',
      })
    run(['init', '-q'], '2026-01-01T00:00:00Z')
    mkdirSync(join(dir, 'pages'))
    writeFileSync(join(dir, 'pages/a.vue'), 'a')
    run(['add', '.'], '2026-01-01T00:00:00Z')
    run(['commit', '-q', '-m', 'a'], '2026-01-01T00:00:00Z')
    writeFileSync(join(dir, 'pages/b.vue'), 'b')
    run(['add', '.'], '2026-02-01T00:00:00Z')
    run(['commit', '-q', '-m', 'b'], '2026-02-01T00:00:00Z')

    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim()
    const result = gitLastCommitDates([join(top, 'pages/a.vue'), join(top, 'pages/b.vue')], dir)
    expect(result.skipped).toBeUndefined()
    expect(result.dates.get(join(top, 'pages/a.vue'))).toBe('2026-01-01T00:00:00.000Z')
    expect(result.dates.get(join(top, 'pages/b.vue'))).toBe('2026-02-01T00:00:00.000Z')
  })
})
