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
 * narduk-libs#341: on the on-prem runner path (~55 KB/s toward GitHub's
 * origin, fleet#430) a 4000 ms abort is too tight for the packument read,
 * and item 2.3 collapsed to `unknown` -> a blocking `UNKNOWN` exit on
 * otherwise-unrelated PRs (buoys#108). 20 s is the default; large enough to
 * clear that link with room to spare (the full packument measured 240 KB
 * live 2026-09-16 -- see the Accept-header note below -- which is ~4.5 s at
 * 55 KB/s before TLS/connect overhead), while still bounded so a genuinely
 * unreachable registry fails closed in a reasonable time budget across the
 * retry loop below.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 20_000

/** Bounded retries on transient failures only (timeout, network error, 5xx).
 * A 401/403/404 is a decided answer, never transient, so it is never
 * retried -- see `fetchPackumentAttempt`. */
const DEFAULT_MAX_RETRIES = 2
const RETRY_BACKOFF_BASE_MS = 150

/** Callers on a known-slow path can widen the timeout without a release,
 * per narduk-libs#341's proposed change. An explicit `fetchTimeoutMs`
 * constructor option always wins over this. */
const TIMEOUT_ENV_VAR = 'NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS'

function envFetchTimeoutOverrideMs(): number | undefined {
  const raw = process.env[TIMEOUT_ENV_VAR]
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Only a 5xx is treated as transient. Any other non-ok, non-404 status
 * (401, 403, 400, 429, ...) is a decided-enough answer that retrying buys
 * nothing but time, and 401/403 specifically must never be retried into
 * looking like a network blip. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600
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

/** The one scope whose route the project `.npmrc` may move (company-hq
 * D-PKG-6: npm.nard.uk mirrors `@narduk-enterprises` only). Every other scope,
 * `@narduk-geo` included, stays on GitHub Packages. */
export const ENTERPRISES_SCOPE = '@narduk-enterprises'

export const GITHUB_PACKAGES_REGISTRY = 'https://npm.pkg.github.com'
const GITHUB_PACKAGES_HOST = 'npm.pkg.github.com'

/** Where `@narduk-enterprises` packuments are read from (narduk-libs#498).
 *
 * - `github-packages`: today's behaviour -- `npm.pkg.github.com`, a Bearer
 *   token, and scope-probe corroboration of an ambiguous 404.
 * - `anonymous`: any other registry the project routes the scope to (the
 *   npm.nard.uk mirror in practice). Read with NO `Authorization` header: the
 *   estate token is only ever sent to GitHub Packages, and this reader never
 *   reads `_authToken` lines or `~/.npmrc`, so a lookalike or custom route
 *   gets an anonymous read, never a credential. */
export type ScopeRoute = { kind: 'github-packages' } | { kind: 'anonymous'; base: string }

const GITHUB_PACKAGES_ROUTE: ScopeRoute = { kind: 'github-packages' }

/** The exact line rule narduk-enterprises/workflows#108 uses in
 * `nuxt-cloudflare.yml` (`/^[ \t]*@narduk-enterprises:registry[ \t]*=[ \t]*"?([^"\s]*)"?[ \t]*$/gm`):
 * an uncommented `@narduk-enterprises:registry=` line, optional whitespace
 * around `=`, optional double quotes, and the LAST such line wins (a later
 * line repointing the scope is the break-glass back to GitHub Packages).
 * Split into a key match and a value match here so neither regex can
 * backtrack super-linearly. */
const SCOPE_ROUTE_KEY_RE = /^[ \t]*@narduk-enterprises:registry[ \t]*=(.*)$/
const SCOPE_ROUTE_VALUE_RE = /^"?([^"\s]*)"?$/

function scopeRouteValues(npmrc: string): string[] {
  const values: string[] = []
  for (const line of npmrc.split('\n')) {
    const key = SCOPE_ROUTE_KEY_RE.exec(line.replace(/\r$/, ''))
    if (!key) continue
    const value = SCOPE_ROUTE_VALUE_RE.exec((key[1] ?? '').trim())
    if (value) values.push(value[1] ?? '')
  }
  return values
}

/** Classify the project's `@narduk-enterprises` route from `.npmrc` text.
 * No file, no route line, an empty or unparseable value, or a non-http(s)
 * value all mean the GitHub Packages default -- the pre-#498 behaviour. */
export function parseScopeRoute(npmrc: string | undefined): ScopeRoute {
  if (!npmrc) return GITHUB_PACKAGES_ROUTE
  const last = scopeRouteValues(npmrc).at(-1)
  if (!last) return GITHUB_PACKAGES_ROUTE
  let url: URL
  try {
    url = new URL(last)
  } catch {
    return GITHUB_PACKAGES_ROUTE
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return GITHUB_PACKAGES_ROUTE
  if (url.hostname === GITHUB_PACKAGES_HOST) return GITHUB_PACKAGES_ROUTE
  return { kind: 'anonymous', base: last.replace(/\/+$/, '') }
}

/** Read the route from `<repoRoot>/.npmrc` -- the project file only, and only
 * its registry lines. */
export function readScopeRoute(repoRoot: string): ScopeRoute {
  const path = join(repoRoot, '.npmrc')
  if (!existsSync(path)) return GITHUB_PACKAGES_ROUTE
  try {
    return parseScopeRoute(readFileSync(path, 'utf8'))
  } catch {
    return GITHUB_PACKAGES_ROUTE
  }
}

/** A scoped name the way npm registries (and the npm.nard.uk mirror) expect
 * it in a packument path: `@scope%2fname`. */
export function encodePackumentName(pkgName: string): string {
  return pkgName.replace('/', '%2f')
}

type PackumentResponse =
  { kind: 'ok'; body: unknown } | { kind: 'not-found' } | { kind: 'unreadable' }

/** `fetchPackumentAttempt`'s own return type: one extra transient variant
 * that `fetchPackument`'s retry loop always resolves away, so callers of
 * `fetchPackument` keep narrowing over the original three-variant
 * `PackumentResponse` unchanged. */
type PackumentAttemptResult = PackumentResponse | { kind: 'retryable-error' }

/** Read `node_modules/<scope>/<name>/package.json` under any of `roots`
 * (root, apps/web, apps/api, web, app -- the same monorepo candidates every
 * other item checks) and fall back to the manifest's own pinned spec, which
 * item 2.2 already requires to be an exact version. */
export class FilesystemRegistryReality implements RegistryReality {
  private readonly roots: string[]
  private readonly fetchTimeoutMs: number
  private readonly maxRetries: number
  private readonly authToken: string | undefined
  private readonly scopeProbePackage: string
  private readonly scopeRoute: ScopeRoute
  /** Memoized so the corroboration probe costs at most one extra request per
   * reader, however many packages 404. */
  private scopeReadable: Promise<boolean> | undefined

  constructor(
    repoRoot: string,
    options: {
      fetchTimeoutMs?: number
      scopeProbePackage?: string
      maxRetries?: number
      /** Overrides the route read from `<repoRoot>/.npmrc`. */
      scopeRoute?: ScopeRoute
    } = {},
  ) {
    this.roots = [
      repoRoot,
      join(repoRoot, 'apps', 'web'),
      join(repoRoot, 'apps', 'api'),
      join(repoRoot, 'web'),
      join(repoRoot, 'app'),
    ]
    this.fetchTimeoutMs =
      options.fetchTimeoutMs ?? envFetchTimeoutOverrideMs() ?? DEFAULT_FETCH_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.scopeProbePackage = options.scopeProbePackage ?? SCOPE_PROBE_PACKAGE
    this.scopeRoute = options.scopeRoute ?? readScopeRoute(repoRoot)
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

  /** The route a given package is read from. Only `@narduk-enterprises/*`
   * follows the project route; every other scope stays on GitHub Packages. */
  private routeFor(pkgName: string): ScopeRoute {
    return pkgName.startsWith(`${ENTERPRISES_SCOPE}/`) ? this.scopeRoute : GITHUB_PACKAGES_ROUTE
  }

  /** One HTTP attempt. `retryable-error` covers everything the caller's
   * bounded retry loop may re-attempt: a timeout/abort, a network error, a
   * malformed body, or a 5xx. A 404 and any other non-ok status are decided
   * answers and returned as such, never as `retryable-error`. */
  private async fetchPackumentAttempt(pkgName: string): Promise<PackumentAttemptResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs)
    const route = this.routeFor(pkgName)
    const url =
      route.kind === 'github-packages'
        ? `${GITHUB_PACKAGES_REGISTRY}/${pkgName}`
        : `${route.base}/${encodePackumentName(pkgName)}`
    try {
      const response = await fetch(url, {
        headers: {
          ...(route.kind === 'github-packages'
            ? { Authorization: `Bearer ${this.authToken}` }
            : {}),
          // Ask for the abbreviated packument (smaller on registries that
          // honour it, per narduk-libs#341's proposed change) with the full
          // shape as a fallback. VERIFIED LIVE 2026-09-16 against
          // @narduk-enterprises/narduk-core: GitHub Packages' npm registry
          // ignores this media type entirely -- both Accept values returned
          // an identical 240097-byte full packument with
          // `content-type: application/json`. Sent anyway (harmless, and
          // registry.npmjs.org plus any future GitHub behaviour do honour
          // it), but on npm.pkg.github.com today it does NOT shrink the
          // read -- the timeout and retry budget below are what actually
          // make this survive the on-prem throughput problem, not this
          // header.
          Accept: 'application/vnd.npm.install-v1+json, application/json',
        },
        signal: controller.signal,
      })
      if (response.status === 404) return { kind: 'not-found' }
      if (!response.ok) {
        return isRetryableStatus(response.status)
          ? { kind: 'retryable-error' }
          : { kind: 'unreadable' }
      }
      return { kind: 'ok', body: await response.json() }
    } catch {
      return { kind: 'retryable-error' }
    } finally {
      clearTimeout(timer)
    }
  }

  /** `maxRetries` bounded retries with backoff, on `retryable-error` only.
   * Fail-closed is preserved: exhausting the budget still resolves to the
   * same `unreadable` a single failed attempt always produced, so a truly
   * unreachable registry still blocks (spec §5, exit code 2). */
  private async fetchPackument(pkgName: string): Promise<PackumentResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.fetchPackumentAttempt(pkgName)
      if (result.kind !== 'retryable-error') return result
      if (attempt >= this.maxRetries) return { kind: 'unreadable' }
      await sleep(RETRY_BACKOFF_BASE_MS * 2 ** attempt)
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
    const onGithubPackages = this.routeFor(pkgName).kind === 'github-packages'
    if (onGithubPackages && !this.authToken) return { status: 'unreadable' }
    const response = await this.fetchPackument(pkgName)
    if (response.kind === 'unreadable') return { status: 'unreadable' }
    if (response.kind === 'not-found') {
      // The 404 ambiguity is a GitHub Packages quirk (it hides packages a
      // token cannot see). An anonymous registry has no entitlement to hide
      // behind, so its 404 is a decided "not published".
      if (!onGithubPackages) return { status: 'unpublished' }
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
