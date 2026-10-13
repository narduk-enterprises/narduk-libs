import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  compareVersions,
  formatPackageCurrencyRows,
  GRACE_PERIOD_DAYS,
  parseExactVersion,
  runPackageCurrencyCheck,
} from '../../src/foundation/evaluate-package-currency.js'
import type { PackageCurrencyRow } from '../../src/foundation/evaluate-package-currency.js'
import type { PublishedRelease, RegistryPublication } from '../../src/foundation/npm-registry.js'
import { fakeReality, makeTempRepo, writeJson } from './helpers.js'

const CORE = '@narduk-enterprises/narduk-core'
const TOOLS = '@narduk-enterprises/narduk-app-tools'

/** A fixed clock for every test that does not set its own. */
const NOW = new Date('2026-10-13T12:00:00.000Z')
const DAY_MS = 86_400_000

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

/** One package pinned in one manifest, installed and published as told. */
async function run(
  write: (root: string) => void,
  reality = fakeReality({
    installed: { [CORE]: { version: '2.6.4', major: 2, source: 'node_modules' } },
    publications: { [CORE]: { status: 'published', latest: '2.6.4', major: 2 } },
  }),
  now: Date = NOW,
) {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return runPackageCurrencyCheck({ now, reality, root })
}

function row(report: { rows: PackageCurrencyRow[] }, pkg: string): PackageCurrencyRow {
  const found = report.rows.find((candidate) => candidate.package === pkg)
  if (!found) throw new Error(`no row for ${pkg}; got ${report.rows.map((r) => r.package).join()}`)
  return found
}

describe('package currency (adoption requirement 2)', () => {
  it('passes an exact pin that matches both node_modules and the registry', async () => {
    const report = await run((root) => {
      writeJson(root, 'package.json', { dependencies: { [CORE]: '2.6.4' } })
    })

    expect(row(report, CORE).status).toBe('current')
    expect(report.clean).toBe(true)
    expect(report.undecided).toBe(false)
  })

  it('reports a pin behind the registry, and names the release it is behind', async () => {
    const report = await run(
      (root) => {
        writeJson(root, 'package.json', { dependencies: { [CORE]: '2.5.0' } })
      },
      fakeReality({
        installed: { [CORE]: { version: '2.5.0', major: 2, source: 'node_modules' } },
        publications: { [CORE]: { status: 'published', latest: '2.6.4', major: 2 } },
      }),
    )

    const core = row(report, CORE)
    expect(core.status).toBe('behind')
    expect(core.latest).toBe('2.6.4')
    expect(core.detail).toContain('2.6.4')
    expect(report.clean).toBe(false)
    // Behind is a decided failure, not an undecided one -- they need different
    // remedies, so the report must not collapse them.
    expect(report.undecided).toBe(false)
  })

  it('refuses a range specifier even when it would resolve to the latest release', async () => {
    const report = await run((root) => {
      writeJson(root, 'package.json', { dependencies: { [CORE]: '^2.6.4' } })
    })

    expect(row(report, CORE).status).toBe('not-exact')
    expect(report.clean).toBe(false)
  })

  it('reports two manifests pinning the same package at different versions', async () => {
    const report = await run((root) => {
      writeJson(root, 'package.json', { devDependencies: { [TOOLS]: '0.10.1' } })
      writeJson(root, 'apps/web/package.json', { devDependencies: { [TOOLS]: '0.13.1' } })
    })

    const tools = row(report, TOOLS)
    expect(tools.status).toBe('disagrees')
    expect(tools.declaredSpecs).toEqual(['0.10.1', '0.13.1'])
    expect(tools.manifests).toEqual(['apps/web/package.json', 'package.json'])
    expect(tools.detail).toContain('0.10.1')
    expect(tools.detail).toContain('0.13.1')
  })

  it('agreeing manifests are one row, not a disagreement', async () => {
    const report = await run(
      (root) => {
        writeJson(root, 'package.json', { devDependencies: { [TOOLS]: '0.13.1' } })
        writeJson(root, 'apps/web/package.json', { devDependencies: { [TOOLS]: '0.13.1' } })
      },
      fakeReality({
        installed: { [TOOLS]: { version: '0.13.1', major: 0, source: 'node_modules' } },
        publications: { [TOOLS]: { status: 'published', latest: '0.13.1', major: 0 } },
      }),
    )

    const tools = row(report, TOOLS)
    expect(tools.status).toBe('current')
    expect(tools.manifests).toHaveLength(2)
  })

  it('catches a manifest that matches the registry while node_modules holds something else', async () => {
    const report = await run(
      (root) => {
        writeJson(root, 'package.json', { dependencies: { [CORE]: '2.6.4' } })
      },
      fakeReality({
        installed: { [CORE]: { version: '2.5.0', major: 2, source: 'node_modules' } },
        publications: { [CORE]: { status: 'published', latest: '2.6.4', major: 2 } },
      }),
    )

    const core = row(report, CORE)
    expect(core.status).toBe('not-installed-as-declared')
    expect(core.installed).toBe('2.5.0')
    expect(report.clean).toBe(false)
  })

  it('does not treat the manifest-pin fallback as evidence of an install', async () => {
    // `source: 'manifest-pin'` is the resolver saying it found nothing in
    // node_modules and read the manifest instead. Comparing that against the
    // manifest is circular, so it must not decide the install question.
    const report = await run(
      (root) => {
        writeJson(root, 'package.json', { dependencies: { [CORE]: '2.6.4' } })
      },
      fakeReality({
        installed: { [CORE]: { version: '2.6.4', major: 2, source: 'manifest-pin' } },
        publications: { [CORE]: { status: 'published', latest: '2.6.4', major: 2 } },
      }),
    )

    const core = row(report, CORE)
    expect(core.status).toBe('current')
    expect(core.installed).toBeNull()
  })

  it('an unreadable registry is undecided, never a pass', async () => {
    const report = await run(
      (root) => {
        writeJson(root, 'package.json', { dependencies: { [CORE]: '2.6.4' } })
      },
      fakeReality({
        installed: { [CORE]: { version: '2.6.4', major: 2, source: 'node_modules' } },
        publications: { [CORE]: { status: 'unreadable' } },
      }),
    )

    expect(row(report, CORE).status).toBe('unreadable')
    expect(report.clean).toBe(false)
    expect(report.undecided).toBe(true)
  })

  it('a workspace link is neither current nor stale, and does not fail the report', async () => {
    const report = await run((root) => {
      writeJson(root, 'package.json', { dependencies: { [CORE]: 'workspace:*' } })
    })

    expect(row(report, CORE).status).toBe('workspace-link')
    expect(report.clean).toBe(true)
  })

  it('a pin ahead of the registry passes, and the detail records the discrepancy', async () => {
    const report = await run(
      (root) => {
        writeJson(root, 'package.json', { dependencies: { [CORE]: '2.7.0' } })
      },
      fakeReality({
        installed: { [CORE]: { version: '2.7.0', major: 2, source: 'node_modules' } },
        publications: { [CORE]: { status: 'published', latest: '2.6.4', major: 2 } },
      }),
    )

    const core = row(report, CORE)
    expect(core.status).toBe('current')
    expect(core.detail).toContain('ahead')
  })

  it('reads only @narduk-enterprises pins, not the whole dependency graph', async () => {
    const report = await run((root) => {
      writeJson(root, 'package.json', {
        dependencies: { [CORE]: '2.6.4', nuxt: '4.5.2', zod: '^4.6.5' },
      })
    })

    expect(report.rows.map((r) => r.package)).toEqual([CORE])
  })
})

/** ISO time `days` days before `NOW`. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

/** core pinned at 2.5.0 in package.json and installed as declared. */
function pinCoreAt(pin: string) {
  return (root: string) => {
    writeJson(root, 'package.json', { dependencies: { [CORE]: pin } })
  }
}

function realityWith(pin: string, publication: RegistryPublication) {
  return fakeReality({
    installed: {
      [CORE]: { version: pin, major: Number(pin.split('.')[0]), source: 'node_modules' },
    },
    publications: { [CORE]: publication },
  })
}

function published(latest: string, releases?: PublishedRelease[]): RegistryPublication {
  return {
    latest,
    major: Number(latest.split('.')[0]),
    status: 'published',
    ...(releases ? { releases } : {}),
  }
}

/** Run with the first missed release (2.6.0) published exactly `ageMs` before NOW. */
async function runWithFirstMissedAge(ageMs: number) {
  return run(
    pinCoreAt('2.5.0'),
    realityWith(
      '2.5.0',
      published('2.6.0', [
        { publishedAt: daysAgo(60), version: '2.5.0' },
        { publishedAt: new Date(NOW.getTime() - ageMs).toISOString(), version: '2.6.0' },
      ]),
    ),
  )
}

describe('the 14-day grace on a pin behind the registry (Logan, 2026-10-13)', () => {
  it('is fourteen days', () => {
    expect(GRACE_PERIOD_DAYS).toBe(14)
  })

  it('day 13: a pin behind a release published 13 days ago passes, and the lag stays visible', async () => {
    const report = await runWithFirstMissedAge(13 * DAY_MS)
    const core = row(report, CORE)

    expect(core.status).toBe('behind-within-grace')
    expect(core.firstMissed).toBe('2.6.0')
    expect(core.graceDue).toBe(new Date(NOW.getTime() + DAY_MS).toISOString())
    expect(core.detail).toContain('within grace')
    expect(core.detail).toContain('due 2026-10-14')
    expect(report.clean).toBe(true)
    expect(report.failures).toEqual([])
    expect(report.withinGrace.map((r) => r.package)).toEqual([CORE])
  })

  it('one millisecond before 14 days still passes', async () => {
    const report = await runWithFirstMissedAge(14 * DAY_MS - 1)
    expect(row(report, CORE).status).toBe('behind-within-grace')
  })

  it('day 14 exactly FAILS: the boundary is exclusive', async () => {
    // "passes until the oldest newer release is 14 days old" -- at 14 days old
    // it no longer passes. Documented in evaluate-package-currency.ts.
    const report = await runWithFirstMissedAge(14 * DAY_MS)
    const core = row(report, CORE)

    expect(core.status).toBe('behind')
    expect(core.detail).toContain('overdue by less than a day')
    expect(report.clean).toBe(false)
    expect(report.undecided).toBe(false)
  })

  it('day 15 fails and names how overdue it is', async () => {
    const report = await runWithFirstMissedAge(15 * DAY_MS)
    const core = row(report, CORE)

    expect(core.status).toBe('behind')
    expect(core.detail).toContain('is behind the latest published release 2.6.0')
    expect(core.detail).toContain('1 day overdue')
    expect(report.clean).toBe(false)
    expect(report.undecided).toBe(false)
  })

  it('the clock runs from the FIRST missed release, not latest: latest 1 day old, first missed 20 days old FAILS', async () => {
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.8.0', [
          { publishedAt: daysAgo(40), version: '2.5.0' },
          { publishedAt: daysAgo(20), version: '2.6.0' },
          { publishedAt: daysAgo(10), version: '2.7.0' },
          { publishedAt: daysAgo(1), version: '2.8.0' },
        ]),
      ),
    )
    const core = row(report, CORE)

    expect(core.status).toBe('behind')
    expect(core.firstMissed).toBe('2.6.0')
    expect(core.detail).toContain('6 days overdue')
    expect(report.clean).toBe(false)
  })

  it('daily releases do not reset the window: a 3-day-old first miss passes whatever latest is', async () => {
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.5.3', [
          { publishedAt: daysAgo(3), version: '2.5.1' },
          { publishedAt: daysAgo(2), version: '2.5.2' },
          { publishedAt: daysAgo(0), version: '2.5.3' },
        ]),
      ),
    )
    expect(row(report, CORE).firstMissed).toBe('2.5.1')
    expect(row(report, CORE).status).toBe('behind-within-grace')
  })

  it('MISSING DATA FAILS CLOSED: no release times at all is plain behind, never within grace', async () => {
    const report = await run(pinCoreAt('2.5.0'), realityWith('2.5.0', published('2.6.0')))
    const core = row(report, CORE)

    expect(core.status).toBe('behind')
    expect(core.firstMissed).toBeNull()
    expect(core.graceDue).toBeNull()
    expect(core.detail).toContain('could not be read')
    expect(report.clean).toBe(false)
    // A decided failure, not an undecided one: the pin IS behind.
    expect(report.undecided).toBe(false)
  })

  it('MISSING DATA FAILS CLOSED: an unknown time on the first missed release is plain behind', async () => {
    // 2.7.0 is recent, but 2.6.0's time is unknown and could be the oldest.
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.7.0', [
          { publishedAt: null, version: '2.6.0' },
          { publishedAt: daysAgo(1), version: '2.7.0' },
        ]),
      ),
    )
    expect(row(report, CORE).status).toBe('behind')
    expect(report.clean).toBe(false)
  })

  it('MISSING DATA FAILS CLOSED: latest absent from the release list is plain behind', async () => {
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith('2.5.0', published('2.6.0', [{ publishedAt: daysAgo(70), version: '2.5.0' }])),
    )
    expect(row(report, CORE).status).toBe('behind')
  })

  it('ignores prereleases above a stable pin', async () => {
    // A 30-day-old 2.6.0-rc.1 must not start the clock for a stable pin.
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.6.0', [
          { publishedAt: daysAgo(30), version: '2.6.0-rc.1' },
          { publishedAt: daysAgo(2), version: '2.6.0' },
        ]),
      ),
    )
    expect(row(report, CORE).firstMissed).toBe('2.6.0')
    expect(row(report, CORE).status).toBe('behind-within-grace')
  })

  it('counts prereleases when the pin is itself a prerelease', async () => {
    const report = await run(
      pinCoreAt('2.6.0-rc.1'),
      realityWith(
        '2.6.0-rc.1',
        published('2.6.0', [
          { publishedAt: daysAgo(30), version: '2.6.0-rc.1' },
          { publishedAt: daysAgo(20), version: '2.6.0-rc.2' },
          { publishedAt: daysAgo(2), version: '2.6.0' },
        ]),
      ),
    )
    expect(row(report, CORE).firstMissed).toBe('2.6.0-rc.2')
    expect(row(report, CORE).status).toBe('behind')
  })

  it('a release above latest (an untagged publish) does not start the clock', async () => {
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.6.0', [
          { publishedAt: daysAgo(2), version: '2.6.0' },
          { publishedAt: daysAgo(1), version: '3.0.0' },
        ]),
      ),
    )
    expect(row(report, CORE).firstMissed).toBe('2.6.0')
  })

  it('a backport published after a newer line: the earliest publish time wins', async () => {
    // 2.5.1 (a backport) went out after 2.6.0; the app has been missing 2.6.0
    // for longer, so 2.6.0 starts the clock.
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.6.0', [
          { publishedAt: daysAgo(1), version: '2.5.1' },
          { publishedAt: daysAgo(20), version: '2.6.0' },
        ]),
      ),
    )
    expect(row(report, CORE).firstMissed).toBe('2.6.0')
    expect(row(report, CORE).status).toBe('behind')
  })

  it('the grace does not soften the other failures', async () => {
    const recent = published('2.6.0', [{ publishedAt: daysAgo(1), version: '2.6.0' }])

    const range = await run(pinCoreAt('^2.5.0'), realityWith('2.5.0', recent))
    expect(row(range, CORE).status).toBe('not-exact')
    expect(range.clean).toBe(false)

    const stale = await run(
      pinCoreAt('2.5.0'),
      fakeReality({
        installed: { [CORE]: { version: '2.4.0', major: 2, source: 'node_modules' } },
        publications: { [CORE]: recent },
      }),
    )
    expect(row(stale, CORE).status).toBe('not-installed-as-declared')
    expect(stale.clean).toBe(false)

    const unreadable = await run(pinCoreAt('2.5.0'), realityWith('2.5.0', { status: 'unreadable' }))
    expect(row(unreadable, CORE).status).toBe('unreadable')
    expect(unreadable.undecided).toBe(true)
  })

  it('the package table shows the lag and the due date', async () => {
    const report = await run(
      pinCoreAt('2.5.0'),
      realityWith(
        '2.5.0',
        published('2.6.0', [{ publishedAt: '2026-10-13T09:00:00.000Z', version: '2.6.0' }]),
      ),
    )
    expect(formatPackageCurrencyRows(report)).toContain(
      '2.5.0 -> 2.6.0  behind, within grace (published 2026-10-13, due 2026-10-27)',
    )

    const overdue = await run(
      pinCoreAt('2.5.0'),
      realityWith('2.5.0', published('2.6.0', [{ publishedAt: daysAgo(20), version: '2.6.0' }])),
    )
    expect(formatPackageCurrencyRows(overdue)).toContain('behind, grace ended')
  })
})

describe('version ordering', () => {
  it('parses an exact release and refuses a range', () => {
    expect(parseExactVersion('2.6.4')).toEqual({
      major: 2,
      minor: 6,
      patch: 4,
      prerelease: null,
    })
    expect(parseExactVersion('^2.6.4')).toBeNull()
    expect(parseExactVersion('2.6')).toBeNull()
    expect(parseExactVersion('workspace:*')).toBeNull()
  })

  it('orders by major, then minor, then patch', () => {
    const older = parseExactVersion('2.5.0')!
    const newer = parseExactVersion('2.6.4')!
    expect(compareVersions(older, newer)).toBeLessThan(0)
    expect(compareVersions(newer, older)).toBeGreaterThan(0)
    expect(compareVersions(newer, newer)).toBe(0)
  })

  it('does not compare 10 as older than 9', () => {
    // The string comparison this replaces got this wrong, and a package on a
    // double-digit minor is the normal case here: narduk-analytics is on 1.21.
    const nine = parseExactVersion('1.9.0')!
    const ten = parseExactVersion('1.21.0')!
    expect(compareVersions(nine, ten)).toBeLessThan(0)
  })

  it('sorts a prerelease below the release of the same number', () => {
    const rc = parseExactVersion('1.2.0-rc.1')!
    const release = parseExactVersion('1.2.0')!
    expect(compareVersions(rc, release)).toBeLessThan(0)
    expect(compareVersions(release, rc)).toBeGreaterThan(0)
  })
})
