/**
 * Adoption requirement 2 -- *current, reproducible dependencies*.
 *
 * Every consumed estate package must be exact-pinned, every manifest that pins
 * it must agree, the version actually installed must be the version declared,
 * and the pin must not stay behind the latest published stable release for
 * longer than the grace window (below). Four separate failures hide behind
 * "the dependencies are fine":
 *
 *   1. A caret or range spec, which makes the build unreproducible.
 *   2. Two manifests in one workspace pinning different versions of the same
 *      package -- the generated apps are pnpm workspaces with the app's own
 *      dependencies in `apps/web`, so a root devDependency and a workspace
 *      devDependency naming the same tool is the normal shape and the normal
 *      way the two fall out of step.
 *   3. A pin that is behind the registry for longer than the grace window.
 *   4. A pin that matches the registry while `node_modules` holds something
 *      else, which is what a stale install looks like from the manifest side.
 *
 * WHY NOT FOLD THIS INTO ITEM 8. `foundation:check:shared-ui-pinned` already
 * refuses a non-exact pin, but only for the shared-UI packages and only on the
 * exactness question. Currency is a different claim on a wider set, and the
 * ratified 7-item contract is not the place to grow it (see
 * `evaluate-capability-coverage.ts` for the same reasoning about item 9).
 *
 * THE 14-DAY GRACE (Logan, 2026-10-13: "14-day grace (Recommended)").
 * narduk-libs releases several times a day, so "any lag behind `latest` fails"
 * turned certified apps red on their next deploy with no change of their own.
 * A pin that is behind now passes as `behind-within-grace` until the OLDEST
 * release it is missing is `GRACE_PERIOD_DAYS` old:
 *
 *   - The clock starts at the first release the app is missing, never at
 *     `latest`. Otherwise a library that releases every day would restart the
 *     window forever. "First" is the earliest publish time among the missing
 *     releases -- on a linear release history that is also the lowest version,
 *     and on a backport it is the stricter of the two.
 *   - The missing releases are the stable releases above the pin, up to
 *     `latest`. Prereleases count only when the pin is itself a prerelease.
 *   - The boundary is EXCLUSIVE: the row passes while `now` is strictly before
 *     `publishedAt + 14 x 24h`. At exactly 14 days it is plain `behind`.
 *   - MISSING DATA FAILS CLOSED. If the publish time of any missing release
 *     cannot be read, nobody can say when the clock started, so the row is
 *     plain `behind` -- never within grace.
 *
 * Only `behind` gets a grace. `not-exact`, `disagrees`,
 * `not-installed-as-declared` and `unreadable` are as strict as they were.
 *
 * REALITY IS INJECTABLE, same discipline as the rest of this directory: the
 * registry and `node_modules` reads live behind `RegistryReality`, so the
 * decision logic is tested against a fake rather than a live registry. The
 * clock is injected the same way (`now`); nothing below reads the wall clock.
 */

import { AppRepo } from './source.js'
import { collectCapabilityInventory } from './capability-inventory.js'
import type { EstateDependencyRow } from './capability-inventory.js'
import type { PublishedRelease, RegistryReality } from './npm-registry.js'

/** How long a pin may stay behind, counted from the publish time of the first
 * release it is missing. Exclusive: see the file header. */
export const GRACE_PERIOD_DAYS = 14
const DAY_MS = 86_400_000
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * DAY_MS

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
  /** Exact and consistent, behind the registry, and the first release it is
   * missing was published less than `GRACE_PERIOD_DAYS` ago. NOT a failure. */
  | 'behind-within-grace'
  /** Exact and consistent, but behind the registry past the grace window, or
   * behind with no readable publish time to start the window from. */
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
  /** For a pin behind the registry: the release the grace clock runs from
   * (the earliest-published release the pin is missing). Null otherwise, and
   * null when no publish time could be read. */
  firstMissed: string | null
  /** ISO publish time of `firstMissed`, or null. */
  firstMissedPublished: string | null
  /** ISO time the grace ends (`firstMissedPublished` + 14 days), or null. The
   * row is `behind-within-grace` strictly before it and `behind` from it on. */
  graceDue: string | null
}

export interface PackageCurrencyReport {
  rows: PackageCurrencyRow[]
  /** Rows whose status is not `current`, `behind-within-grace` or
   * `workspace-link`. */
  failures: PackageCurrencyRow[]
  /** True when every row is `current`, `behind-within-grace` or
   * `workspace-link`. */
  clean: boolean
  /** Rows that are behind but inside the grace window. Passing, and listed so
   * a report can still show the lag and its due date. */
  withinGrace: PackageCurrencyRow[]
  /** True when at least one row could not be decided against the registry.
   * Separated from `clean` because an unreadable registry is an undecided
   * check, not a failed one, and the two need different remedies. */
  undecided: boolean
}

export interface ParsedVersion {
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

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function overdueLabel(days: number): string {
  if (days < 1) return 'overdue by less than a day'
  return `${days} day${days === 1 ? '' : 's'} overdue`
}

/**
 * The release the grace clock runs from: of the releases above `pin` and at
 * or below `latest` (stable only, unless `pin` is a prerelease), the one
 * published earliest. Null -- fail closed -- when there are no release times,
 * or when ANY candidate's time is unknown: the unknown one could be the
 * earliest, and skipping it would silently start the clock later.
 *
 * `latest` itself is always a candidate, even if the registry's version list
 * somehow omits it, so an incomplete list cannot hide the release the pin is
 * most obviously missing.
 */
export function firstMissedRelease(
  pin: ParsedVersion,
  latest: ParsedVersion,
  releases: readonly PublishedRelease[] | undefined,
): { version: string; publishedMs: number } | null {
  if (!releases) return null
  const allowPrerelease = pin.prerelease !== null
  const times = new Map<string, string | null>()
  for (const release of releases) times.set(release.version, release.publishedAt)

  const candidates: string[] = []
  const seen = new Set<string>()
  const latestText = formatVersion(latest)
  for (const version of [...times.keys(), latestText]) {
    if (seen.has(version)) continue
    seen.add(version)
    const parsed = parseExactVersion(version)
    if (!parsed) continue
    if (parsed.prerelease !== null && !allowPrerelease) continue
    if (compareVersions(parsed, pin) <= 0) continue
    if (compareVersions(parsed, latest) > 0) continue
    candidates.push(version)
  }
  if (candidates.length === 0) return null

  let earliest: { version: string; publishedMs: number } | null = null
  for (const version of candidates) {
    const raw = times.get(version) ?? null
    const ms = raw === null ? Number.NaN : Date.parse(raw)
    if (Number.isNaN(ms)) return null
    if (earliest === null || ms < earliest.publishedMs) earliest = { publishedMs: ms, version }
  }
  return earliest
}

function formatVersion(version: ParsedVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease === null ? core : `${core}-${version.prerelease}`
}

async function evaluateOne(
  pkgName: string,
  pins: readonly EstateDependencyRow[],
  reality: RegistryReality,
  now: Date,
): Promise<PackageCurrencyRow> {
  const declaredSpecs = [...new Set(pins.map((pin) => pin.version))].sort()
  const manifests = [...new Set(pins.map((pin) => pin.manifest))].sort()
  const declared = declaredSpecs[0] ?? ''
  const base = {
    declared,
    declaredSpecs,
    firstMissed: null,
    firstMissedPublished: null,
    graceDue: null,
    manifests,
    package: pkgName,
  }

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
    const behindDetail = `${declared} is behind the latest published release ${publication.latest}`
    const behindBase = {
      ...base,
      installed: installedVersion,
      latest: publication.latest,
    }
    const clock = firstMissedRelease(parsed, latestParsed, publication.releases)
    if (clock === null) {
      return {
        ...behindBase,
        detail: `${behindDetail}; the publish time of the releases it is missing could not be read, so no ${GRACE_PERIOD_DAYS}-day grace applies`,
        status: 'behind',
      }
    }
    const dueMs = clock.publishedMs + GRACE_PERIOD_MS
    const graceFields = {
      firstMissed: clock.version,
      firstMissedPublished: new Date(clock.publishedMs).toISOString(),
      graceDue: new Date(dueMs).toISOString(),
    }
    const published = isoDay(clock.publishedMs)
    const due = isoDay(dueMs)
    if (now.getTime() < dueMs) {
      return {
        ...behindBase,
        ...graceFields,
        detail: `${behindDetail}, within grace (${clock.version} published ${published}, due ${due})`,
        status: 'behind-within-grace',
      }
    }
    const overdueDays = Math.floor((now.getTime() - dueMs) / DAY_MS)
    return {
      ...behindBase,
      ...graceFields,
      detail: `${behindDetail}; the ${GRACE_PERIOD_DAYS}-day grace from ${clock.version} (published ${published}) ended ${due}, ${overdueLabel(overdueDays)}`,
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
  /** The clock the grace window is measured against. Required, so no default
   * can quietly read the wall clock inside the decision; the adoption report
   * passes its own `generated` time. */
  now: Date
}

export async function runPackageCurrencyCheck(
  options: RunPackageCurrencyOptions,
): Promise<PackageCurrencyReport> {
  const repo = new AppRepo(options.root)
  const { inventory } = collectCapabilityInventory(repo)
  const grouped = groupByPackage(inventory.dependencies)

  const rows: PackageCurrencyRow[] = []
  for (const [pkgName, pins] of [...grouped.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push(await evaluateOne(pkgName, pins, options.reality, options.now))
  }

  const failures = rows.filter((row) => !PASSING_STATUSES.has(row.status))
  return {
    clean: failures.length === 0,
    failures,
    rows,
    undecided: failures.some((row) => row.status === 'unreadable'),
    withinGrace: rows.filter((row) => row.status === 'behind-within-grace'),
  }
}

/** The statuses that are not a failure of requirement 2. */
export const PASSING_STATUSES: ReadonlySet<PackageCurrencyStatus> = new Set([
  'current',
  'behind-within-grace',
  'workspace-link',
])

export function formatPackageCurrencyRows(report: PackageCurrencyReport): string {
  if (report.rows.length === 0) return '  (no @narduk-enterprises/* pins found)'
  const width = Math.max(...report.rows.map((row) => row.package.length))
  return report.rows
    .map((row) => {
      const name = row.package.padEnd(width)
      const latest = row.latest ? ` -> ${row.latest}` : ''
      return `  ${name}  ${row.declared}${latest}  ${statusLabel(row)}`
    })
    .join('\n')
}

/** The status column of the package table. A row behind the registry carries
 * its grace state and due date, so the lag stays visible while it passes:
 * `behind, within grace (published 2026-10-13, due 2026-10-27)`. */
function statusLabel(row: PackageCurrencyRow): string {
  if (row.status === 'behind-within-grace' && row.firstMissedPublished && row.graceDue) {
    return `behind, within grace (published ${row.firstMissedPublished.slice(0, 10)}, due ${row.graceDue.slice(0, 10)})`
  }
  if (row.status === 'behind' && row.graceDue) {
    return `behind, grace ended ${row.graceDue.slice(0, 10)}`
  }
  if (row.status === 'behind') return 'behind, no publish time (no grace)'
  return row.status
}
