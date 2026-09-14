/**
 * Version resolution for sub-checks 2.3 (narduk-core's N-1 window, D-PKG-2)
 * and P7 (eslint-config major >= 2) -- both need the RESOLVED version, not
 * the manifest spec string, which is exactly why spec §3 assigns them to
 * `foundation:check` and marks them `unknown` in the rollup's static half.
 *
 * REALITY IS INJECTABLE, same discipline as company-hq's
 * `check-web-foundation.py`: the live network/`node_modules` reads live
 * behind `RegistryReality`, so tests exercise the decision logic against a
 * fake without touching a real registry or filesystem.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ResolvedVersion {
  /** The literal installed/pinned version string, e.g. "3.4.1". */
  version: string
  major: number
  /** Where the version came from, for sub-check detail text. */
  source: 'node_modules' | 'manifest-pin'
}

/** Distinguishes "the registry could not be read" from "the package has no
 * published versions". `latestPublishedMajor()` collapses both to `null`
 * (item 2.3 only needs "could we see a major?"); callers that report on
 * publication itself need the split.
 *
 * `unpublished` is only ever returned when the reader has POSITIVE evidence
 * that it can see the scope at all -- see `publicationOf`. Everything
 * ambiguous is `unreadable`, because a consumer that turns "I could not
 * tell" into a pass is a silent green. */
export type RegistryPublication =
  | { status: 'unreadable' }
  | { status: 'unpublished' }
  | { status: 'published'; latest: string; major: number }

export interface RegistryReality {
  /** The resolved (installed, or manifest-pinned as a fallback) version of a
   * package this app depends on, or null if undecidable. */
  resolveInstalled(pkgName: string, pinnedSpec: string | undefined): ResolvedVersion | null
  /** The highest published major version on the registry, or null if a
   * registry read could not be made (no credential, no network, timeout)
   * or the package has no published versions. */
  latestPublishedMajor(pkgName: string): Promise<number | null>
  /** Publication status of a package. `unpublished` is a decided fact;
   * `unreadable` is an undecided one, and every ambiguity resolves to it. */
  publicationOf(pkgName: string): Promise<RegistryPublication>
}

const EXACT_PIN_RE = /^(\d+)\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i

function majorOf(version: string): number | null {
  const match = EXACT_PIN_RE.exec(version)
  return match ? Number(match[1]) : null
}

/**
 * A package the reader probes ONCE to learn whether its token can see the
 * `@narduk-enterprises` scope at all. It has to be a package the estate treats
 * as always published -- `narduk-core` is one of item 2.1's four mandatory
 * packages, so an estate token that cannot read it is a token that cannot read
 * anything. If the probe itself is inconclusive the reader fails toward
 * `unreadable`, so a wrong guess here costs an `unknown`, never a silent pass.
 */
export const SCOPE_PROBE_PACKAGE = '@narduk-enterprises/narduk-core'

type PackumentResponse =
  { kind: 'ok'; body: unknown } | { kind: 'not-found' } | { kind: 'unreadable' }

/** Read `node_modules/<scope>/<name>/package.json` under any of `roots`
 * (root, apps/web, apps/api, web, app -- the same monorepo candidates every
 * other item checks) and fall back to the manifest's own pinned spec, which
 * item 2.2 already requires to be an exact version. */
export class FilesystemRegistryReality implements RegistryReality {
  private readonly roots: string[]
  private readonly fetchTimeoutMs: number
  private readonly authToken: string | undefined
  private readonly scopeProbePackage: string
  /** Memoized so the corroboration probe costs at most one extra request per
   * reader, however many packages 404. */
  private scopeReadable: Promise<boolean> | undefined

  constructor(
    repoRoot: string,
    options: { fetchTimeoutMs?: number; scopeProbePackage?: string } = {},
  ) {
    this.roots = [
      repoRoot,
      join(repoRoot, 'apps', 'web'),
      join(repoRoot, 'apps', 'api'),
      join(repoRoot, 'web'),
      join(repoRoot, 'app'),
    ]
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 4000
    this.scopeProbePackage = options.scopeProbePackage ?? SCOPE_PROBE_PACKAGE
    this.authToken =
      process.env.NODE_AUTH_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? undefined
  }

  resolveInstalled(pkgName: string, pinnedSpec: string | undefined): ResolvedVersion | null {
    for (const root of this.roots) {
      const path = join(root, 'node_modules', ...pkgName.split('/'), 'package.json')
      if (!existsSync(path)) continue
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string') {
          const major = majorOf(parsed.version)
          if (major !== null) return { version: parsed.version, major, source: 'node_modules' }
        }
      } catch {
        // fall through to the manifest pin
      }
    }
    if (pinnedSpec) {
      const major = majorOf(pinnedSpec)
      if (major !== null) return { version: pinnedSpec, major, source: 'manifest-pin' }
    }
    return null
  }

  private async fetchPackument(pkgName: string): Promise<PackumentResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs)
    try {
      const response = await fetch(`https://npm.pkg.github.com/${pkgName}`, {
        headers: { Authorization: `Bearer ${this.authToken}`, Accept: 'application/json' },
        signal: controller.signal,
      })
      if (response.status === 404) return { kind: 'not-found' }
      if (!response.ok) return { kind: 'unreadable' }
      return { kind: 'ok', body: await response.json() }
    } catch {
      return { kind: 'unreadable' }
    } finally {
      clearTimeout(timer)
    }
  }

  /** GitHub Packages answers "no such package" and "your token cannot see
   * this package" with the same 404 -- it does not confirm the existence of
   * things you are not entitled to read. Corroborate with one probe against a
   * package the estate always publishes: if THAT reads, the token can see the
   * scope and the 404 is a real "not published"; if it does not, the 404 says
   * nothing about publication and the answer is `unreadable`.
   *
   * A 404 on the probe package itself cannot be corroborated by definition,
   * so it stays `unreadable`. */
  private corroborateScopeReadable(pkgName: string): Promise<boolean> {
    if (pkgName === this.scopeProbePackage) return Promise.resolve(false)
    this.scopeReadable ??= this.fetchPackument(this.scopeProbePackage).then(
      (response) => response.kind === 'ok',
    )
    return this.scopeReadable
  }

  async publicationOf(pkgName: string): Promise<RegistryPublication> {
    if (!this.authToken) return { status: 'unreadable' }
    const response = await this.fetchPackument(pkgName)
    if (response.kind === 'unreadable') return { status: 'unreadable' }
    if (response.kind === 'not-found') {
      return (await this.corroborateScopeReadable(pkgName))
        ? { status: 'unpublished' }
        : { status: 'unreadable' }
    }

    const body = response.body as {
      'dist-tags'?: { latest?: string }
      versions?: Record<string, unknown>
    }
    const latestTag = body['dist-tags']?.latest
    if (typeof latestTag === 'string') {
      const major = majorOf(latestTag)
      if (major !== null) return { status: 'published', latest: latestTag, major }
    }
    const published = (body.versions ? Object.keys(body.versions) : [])
      .map((version) => ({ version, major: majorOf(version) }))
      .filter((entry): entry is { version: string; major: number } => entry.major !== null)
    if (published.length === 0) return { status: 'unpublished' }
    published.sort((left, right) => left.major - right.major)
    const top = published[published.length - 1]
    return top
      ? { status: 'published', latest: top.version, major: top.major }
      : { status: 'unpublished' }
  }

  async latestPublishedMajor(pkgName: string): Promise<number | null> {
    const publication = await this.publicationOf(pkgName)
    return publication.status === 'published' ? publication.major : null
  }
}
