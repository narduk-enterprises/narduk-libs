/*
 * The SSR regression guard for `@narduk-enterprises/narduk-shell/format` —
 * components backlog item 5 (narduk-libs#252).
 *
 * `test/format.test.ts` asserts what the formatters produce. This file asserts
 * the property the item exists for: **the same input produces the same string
 * on any host**. A Nuxt app renders every page once on a server (UTC, in a
 * Cloudflare Worker) and again in a browser (the reader's zone and locale), so
 * a formatter that consults either one produces two different strings for one
 * value, and Vue's hydration check turns that into a visible flicker or a
 * dropped server render — operator-portal#262 and #268, stonx#674 and #675.
 *
 * The proof is a child process, not a mocked global: Node reads `TZ` and
 * `LC_ALL`/`LANG` when it starts, so setting them mid-process would prove
 * something weaker about a different mechanism. `test/support/format-probe.mjs`
 * prints the whole surface against fixed inputs; this file runs it under three
 * zones and two locales and requires byte-identical stdout — which is also the
 * standing proof that the module loads in plain Node, with no bundler, no Vue
 * and no Nuxt.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime, formatRelative } from '../src/format'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const probe = join(packageRoot, 'test', 'support', 'format-probe.mjs')
const source = readFileSync(join(packageRoot, 'src', 'format.ts'), 'utf8')

/** `src/format.ts` with its comments removed, so a doc comment cannot satisfy
 *  — or violate — any of the source rules below. */
const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(?<![:/])\/\/[^\n]*/g, '')

function runProbe(environment: Record<string, string>): string {
  return execFileSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
}

it('runs in an environment with no DOM, which is what a Nitro server render is', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('the host environment cannot reach the output', () => {
  const baseline = runProbe({ TZ: 'UTC', LC_ALL: 'en-US', LANG: 'en-US' })

  it('produces output at all, so the comparisons below are not comparing two empty strings', () => {
    expect(baseline.split('\n').filter(Boolean).length).toBeGreaterThan(20)
    // Enough of the real thing to show the probe ran the formatters, without
    // pinning the space ICU puts before AM/PM (it has changed between ICU
    // releases and is not what this file is about).
    expect(baseline).toContain('"name":"dateTime.zoneName"')
    expect(baseline).toMatch(/Mar 8, 2026,.*CDT/)
    expect(baseline).toMatch(/Jan 8, 2026,.*CST/)
  })

  for (const timeZone of ['America/Chicago', 'Asia/Tokyo', 'Australia/Eucla']) {
    it(`renders identically under TZ=${timeZone}`, () => {
      expect(runProbe({ TZ: timeZone, LC_ALL: 'en-US', LANG: 'en-US' })).toBe(baseline)
    })
  }

  for (const locale of ['de-DE', 'ja-JP']) {
    it(`renders identically under LC_ALL=${locale}`, () => {
      expect(runProbe({ TZ: 'America/Chicago', LC_ALL: locale, LANG: locale })).toBe(baseline)
    })
  }

  it('is a gate that can fail: the host env does change an unpinned Intl formatter', () => {
    // Without this, a probe that silently stopped formatting anything would
    // still pass every comparison above.
    const read = [
      'process.stdout.write(new Intl.DateTimeFormat().resolvedOptions().timeZone',
      "+ ' ' + new Intl.NumberFormat().format(1234.5))",
    ].join('')
    const under = (environment: Record<string, string>) =>
      execFileSync(process.execPath, ['-e', read], {
        encoding: 'utf8',
        env: { ...process.env, ...environment },
      })
    expect(under({ TZ: 'UTC', LC_ALL: 'en-US', LANG: 'en-US' })).not.toBe(
      under({ TZ: 'Asia/Tokyo', LC_ALL: 'de-DE', LANG: 'de-DE' }),
    )
  })
})

describe('the source itself', () => {
  it('never reads the ambient clock', () => {
    // formatRelative takes `now`. Nothing else here has any business knowing
    // what time it is.
    expect(code).not.toMatch(/\bDate\.now\b/)
    expect(code).not.toMatch(/\bnew Date\(\s*\)/)
    expect(code).not.toMatch(/\bperformance\.now\b/)
  })

  it('never resolves the host time zone or the host locale', () => {
    expect(code).not.toMatch(/resolvedOptions\s*\(\s*\)/)
    expect(code).not.toMatch(/navigator\.languages?/)
    // Every Intl constructor is handed an explicit locale.
    expect(code).not.toMatch(/new Intl\.\w+\(\s*[{)]/)
  })

  it('imports nothing at all, which is what keeps it loadable by Node and by jiti', () => {
    expect(code).not.toMatch(/^\s*import\s/m)
    expect(code).not.toMatch(/\bfrom\s+['"]/)
    expect(code).not.toMatch(/\brequire\s*\(/)
  })

  it('carries no `.ts`-extension import, which would break every consuming app', () => {
    // `src/format.ts` is what `exports["./format"].types` points at, so an
    // app's own tsc reads it. TypeScript rejects an explicit `.ts` extension
    // with TS5097 unless that app turns on allowImportingTsExtensions, which
    // is not something this package may require of its consumers. The probe in
    // test/support/ needs the extension and is never packed.
    expect(code).not.toMatch(/['"][^'"]*\.ts['"]/)
  })
})

describe('server and client agree for a value rendered on both', () => {
  it('gives one answer for one instant, whatever the reader is running', () => {
    // The in-process half of the same claim: two callers who pass the same
    // options get the same string, so a value rendered on the server and
    // re-rendered in the browser hydrates cleanly.
    const at = '2026-03-08T08:30:00Z'
    const options = { timeZone: 'America/Chicago', locale: 'en-US' } as const
    expect(formatDate(at, options)).toBe(formatDate(new Date(at), options))
    expect(formatDateTime(at, options)).toBe(formatDateTime(Date.parse(at), options))
    expect(formatRelative(at, { ...options, now: '2026-03-08T11:30:00Z' })).toBe(
      formatRelative(Date.parse(at), { ...options, now: Date.parse('2026-03-08T11:30:00Z') }),
    )
  })
})
