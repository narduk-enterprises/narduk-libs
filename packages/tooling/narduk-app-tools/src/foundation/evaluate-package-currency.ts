/**
 * Adoption requirement 2 -- *current, reproducible dependencies*.
 *
 * Every consumed estate package must be exact-pinned at the latest published
 * stable release, every manifest that pins it must agree, and the version
 * actually installed must be the version declared. Four separate failures hide
 * behind "the dependencies are fine":
 *
 *   1. A caret or range spec, which makes the build unreproducible.
 *   2. Two manifests in one workspace pinning different versions of the same
 *      package -- the generated apps are pnpm workspaces with the app's own
 *      dependencies in `apps/web`, so a root devDependency and a workspace
 *      devDependency naming the same tool is the normal shape and the normal
 *      way the two fall out of step.
 *   3. A pin that is behind the registry.
 *   4. A pin that matches the registry while `node_modules` holds something
 *      else, which is what a stale install looks like from the manifest side.
 *
 * WHY NOT FOLD THIS INTO ITEM 8. `foundation:check:shared-ui-pinned` already
 * refuses a non-exact pin, but only for the shared-UI packages and only on the
 * exactness question. Currency is a different claim on a wider set, and the
 * ratified 7-item contract is not the place to grow it (see
 * `evaluate-capability-coverage.ts` for the same reasoning about item 9).
 *
 * REALITY IS INJECTABLE, same discipline as the rest of this directory: the
 * registry and `node_modules` reads live behind `RegistryReality`, so the
 * decision logic is tested against a fake rather than a live registry.
 */

import { AppRepo } from './source.js'
import { collectCapabilityInventory } from './capability-inventory.js'
import type { EstateDependencyRow } from './capability-inventory.js'
import type { RegistryReality } from './npm-registry.js'

/** An exact release, optionally a prerelease. Anything else -- `^1.2.3`,
 * `~1.2`, `1.x`, `>=1`, a URL, a tarball path -- is not exact. */
const EXACT_PIN_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Z.-]+))?$/i

/** A `workspace:` protocol spec is a monorepo-internal link. It is neither
 * current nor stale -- it does not name a published version at all -- so it is
 * reported in its own state rather than counted as a failure. A consuming app
 * has none of these; narduk-libs itself is full of them. */
const WORKSPACE_PROTOCOL = 'workspace:'

export type PackageCurrencyStatus =
  /** Exact, agreed across manifests, installed as declared, and latest. */
  | 'current'
  /** Exact and consistent, but the registry has a newer stable release. */
  | 'behind'
  /** The specifier is not an exact version. */
  | 'not-exact'
  /** Two manifests pin the same package at different specifiers. */
  | 'disagrees'
  /** The declared version is not what `node_modules` resolved. */
  | 'not-installed-as-declared'
  /** A `workspace:` link; no published version to compare against. */
  | 'workspace-link'
  /** The registry could not be read. Never a pass: "we could not tell" is not
   * evidence that the pin is current. */
  | 'unreadable'

export interface PackageCurrencyRow {
  package: string
  /** The specifier as written, or the first one when manifests disagree. */
  declared: string
  /** Every distinct specifier found, sorted. One entry when they agree. */
  declaredSpecs: string[]
  /** Every manifest that pins it, repo-relative, sorted. */
  manifests: string[]
  /** What `node_modules` resolved, or null when nothing was installed. */
  installed: string | null
  /** The latest published stable release, or null when unreadable. */
  latest: string | null
  status: PackageCurrencyStatus
  detail: string
}

export interface PackageCurrencyReport {
  rows: PackageCurrencyRow[]
  /** Rows whose status is neither `current` nor `workspace-link`. */
  failures: PackageCurrencyRow[]
  /** True when every row is `current` or `workspace-link`. */
  clean: boolean
  /** True when at least one row could not be decided against the registry.
   * Separated from `clean` because an unreadable registry is an undecided
   * check, not a failed one, and the two need different remedies. */
  undecided: boolean
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export function parseExactVersion(spec: string): ParsedVersion | null {
  const match = EXACT_PIN_RE.exec(spec)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/**
 * Ordering over exact releases. Returns a negative number when `left` is
 * older, 0 when they are the same release, positive when `left` is newer.
 *
 * A prerelease sorts BELOW its own release (`1.2.0-rc.1` < `1.2.0`), which is
 * semver's rule and the one that matters here: an app pinned to a release
 * candidate is behind the stable release of the same number, not level with
 * it. Prerelease identifiers themselves are compared as a plain string, which
 * is enough to order `rc.1` before `rc.2` and is not asked to do more -- a
 * pin on a prerelease is already reported, because `latest` on the registry is
 * a stable release and the row comes back `behind`.
 */
export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return left.prerelease < right.prerelease ? -1 : 1
}

function groupByPackage(rows: readonly EstateDependencyRow[]): Map<string, EstateDependencyRow[]> {
  const grouped = new Map<string, EstateDependencyRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.package)
    if (existing) existing.push(row)
    else grouped.set(row.package, [row])
  }
  return grouped
}

async function evaluateOne(
  pkgName: string,
  pins: readonly EstateDependencyRow[],
  reality: RegistryReality,
): Promise<PackageCurrencyRow> {
  const declaredSpecs = [...new Set(pins.map((pin) => pin.version))].sort()
  const manifests = [...new Set(pins.map((pin) => pin.manifest))].sort()
  const declared = declaredSpecs[0] ?? ''
  const base = { declared, declaredSpecs, manifests, package: pkgName }

  if (declaredSpecs.every((spec) => spec.startsWith(WORKSPACE_PROTOCOL))) {
    return {
      ...base,
      detail: 'workspace link; no published version to compare against',
      installed: null,
      latest: null,
      status: 'workspace-link',
    }
  }

  // Checked BEFORE exactness so a workspace that pins one manifest exactly and
  // another loosely reports the disagreement, which is the bigger fact.
  if (declaredSpecs.length > 1) {
    return {
      ...base,
      detail: `${manifests.join(' and ')} pin different versions: ${declaredSpecs.join(', ')}`,
      installed: reality.resolveInstalled(pkgName, declared)?.version ?? null,
      latest: null,
      status: 'disagrees',
    }
  }

  const parsed = parseExactVersion(declared)
  if (!parsed) {
    return {
      ...base,
      detail: `"${declared}" is not an exact version; an estate package is exact-pinned`,
      installed: reality.resolveInstalled(pkgName, declared)?.version ?? null,
      latest: null,
      status: 'not-exact',
    }
  }

  const installed = reality.resolveInstalled(pkgName, declared)
  // `manifest-pin` means the resolver fell back to the manifest because
  // nothing was installed, so it is not independent evidence of the install.
  const installedVersion = installed?.source === 'node_modules' ? installed.version : null
  if (installedVersion !== null && installedVersion !== declared) {
    return {
      ...base,
      detail: `declared ${declared}, but node_modules resolved ${installedVersion}`,
      installed: installedVersion,
      latest: null,
      status: 'not-installed-as-declared',
    }
  }

  const publication = await reality.publicationOf(pkgName)
  if (publication.status !== 'published') {
    return {
      ...base,
      detail:
        publication.status === 'unpublished'
          ? 'the registry has no published version of this package'
          : 'the registry could not be read; currency is undecided',
      installed: installedVersion,
      latest: null,
      status: 'unreadable',
    }
  }

  const latestParsed = parseExactVersion(publication.latest)
  if (!latestParsed) {
    return {
      ...base,
      detail: `the registry reported "${publication.latest}", which is not an exact version`,
      installed: installedVersion,
      latest: publication.latest,
      status: 'unreadable',
    }
  }

  const ordering = compareVersions(parsed, latestParsed)
  if (ordering < 0) {
    return {
      ...base,
      detail: `${declared} is behind the latest published release ${publication.latest}`,
      installed: installedVersion,
      latest: publication.latest,
      status: 'behind',
    }
  }

  return {
    ...base,
    // A pin AHEAD of the registry's `latest` is an unpublished local build or
    // a dist-tag that has not moved. It is reported as current rather than
    // failed: nothing about it is stale, and the registry is the thing that is
    // behind. The detail records the discrepancy so it is not silent.
    detail:
      ordering > 0
        ? `${declared} is ahead of the registry's latest (${publication.latest})`
        : `${declared} is the latest published release`,
    installed: installedVersion,
    latest: publication.latest,
    status: 'current',
  }
}

export interface RunPackageCurrencyOptions {
  root: string
  reality: RegistryReality
}

export async function runPackageCurrencyCheck(
  options: RunPackageCurrencyOptions,
): Promise<PackageCurrencyReport> {
  const repo = new AppRepo(options.root)
  const { inventory } = collectCapabilityInventory(repo)
  const grouped = groupByPackage(inventory.dependencies)

  const rows: PackageCurrencyRow[] = []
  for (const [pkgName, pins] of [...grouped.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push(await evaluateOne(pkgName, pins, options.reality))
  }

  const failures = rows.filter((row) => row.status !== 'current' && row.status !== 'workspace-link')
  return {
    clean: failures.length === 0,
    failures,
    rows,
    undecided: failures.some((row) => row.status === 'unreadable'),
  }
}

export function formatPackageCurrencyRows(report: PackageCurrencyReport): string {
  if (report.rows.length === 0) return '  (no @narduk-enterprises/* pins found)'
  const width = Math.max(...report.rows.map((row) => row.package.length))
  return report.rows
    .map((row) => {
      const name = row.package.padEnd(width)
      const latest = row.latest ? ` -> ${row.latest}` : ''
      return `  ${name}  ${row.declared}${latest}  ${row.status}`
    })
    .join('\n')
}
