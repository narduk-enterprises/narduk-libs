import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  compareVersions,
  parseExactVersion,
  runPackageCurrencyCheck,
} from '../../src/foundation/evaluate-package-currency.js'
import type { PackageCurrencyRow } from '../../src/foundation/evaluate-package-currency.js'
import { fakeReality, makeTempRepo, writeJson } from './helpers.js'

const CORE = '@narduk-enterprises/narduk-core'
const TOOLS = '@narduk-enterprises/narduk-app-tools'

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
) {
  const root = makeTempRepo()
  tempDirs.push(root)
  write(root)
  return runPackageCurrencyCheck({ reality, root })
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
