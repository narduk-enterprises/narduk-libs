/**
 * `narduk-app verify --live` -- the live proof of the Narduk deployment
 * standard (deployment-standard design §6.2, company-hq#745).
 *
 * Three assertions against a running deployment, and the same code runs in all
 * three places the standard needs them: the preview gate (T0), the promote
 * job's post-deploy proof (T3, which is the auto-rollback trigger), and a human
 * debugging an incident.
 *
 *   1. `x-build-version` is the commit that was promoted. Compared as a hex
 *      prefix in both directions: narduk-core publishes `GITHUB_SHA.slice(0,12)`
 *      or a 12-character git SHA (`packages/modules/narduk-core/src/module.ts`),
 *      while `git rev-parse --short` emits 7 and `GITHUB_SHA` is 40. Verified
 *      live 2026-09-17: `curl -sSI https://buoystat.us/` ->
 *      `x-build-version: f736b07d7f49`.
 *   2. `/api/health` is healthy per the narduk-core health contract:
 *      `{ success, data: { status, timestamp, database, missingAuthTables, checks } }`
 *      (`packages/modules/narduk-core/runtime/server/api/health.get.ts`).
 *   3. One app-declared smoke route answers 2xx with the expected content type.
 *
 * `degraded` is its own decision, and the design is ambiguous about it: §6.2
 * asks for BOTH `data.status == "ok"` AND "every check with `required: true`
 * reporting `result: "pass"`, and under the core contract those two disagree
 * exactly in the degraded case -- an optional check failed, so every required
 * one passed but the status is not `ok`. This command takes the literal
 * reading: `degraded` fails by default, because a proof that green-lights a
 * partly-broken release is not a proof. `--allow-degraded` takes the other
 * reading for an app whose optional checks are known to flap, and the report
 * still records the status verbatim either way.
 *
 * Retries cover the whole pass, not just the header. A promotion has to
 * propagate, and a cold isolate answered in 3.1 s where a warm one answered in
 * 0.26 s when the design measured it, so a single-shot proof is a flaky gate.
 * The retry is bounded and every attempt is reported.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * --------------------------------------
 * It proves that, at this moment, a request this process made to the origin of
 * `--base-url` was answered by a deployment reporting the expected build, a
 * healthy `/api/health`, and a 2xx smoke route.
 *
 * It does NOT prove:
 *   - that a *cached* copy of the previous release is gone from every edge. The
 *     proof asks every hop not to cache (`no-store`, `cache-control: no-cache`)
 *     and adds a per-run query parameter, so the answer it reads is the origin's
 *     current one -- which is what triggers a rollback -- but other visitors may
 *     still be served a cached page. Cache purge is a separate concern (§6.5).
 *   - anything about a different origin. Redirects are followed, because an
 *     apex that 308s to `www` is ordinary, but a final origin other than
 *     `--base-url`'s is refused: §2.3's hazard is exactly a second Worker, in a
 *     second account, answering the same hostname, and a proof that reads *its*
 *     headers is a proof of the wrong deployment.
 *   - that every route works, that the release is correct, or that Cloudflare's
 *     own configuration matches what the repository declares.
 */

import {
  createDnsDiagnoser,
  createResolverProbe,
  PUBLIC_RESOLVERS,
  VERIFY_RESOLVER_MODES,
  type PublicResolve,
  type VerifyResolverMode,
} from './live-dns.js'
import type { LiveProbe, LiveResponse } from './live-probe.js'

/** Distinct per failure class, so a promote job can branch without parsing text. */
export const VERIFY_EXIT = {
  pass: 0,
  /** Usage error. Thrown during parsing and rendered by the CLI. */
  usage: 1,
  /** The deployment could not be read at all. */
  unreachable: 2,
  /** It answered, but with a different build than the one expected. */
  buildVersionMismatch: 3,
  /** The build is right and `/api/health` is not healthy. */
  healthFailed: 4,
  /** Build and health are fine and the smoke route is not. */
  smokeFailed: 5,
  /** The request was answered by a different origin than the one under proof. */
  offOrigin: 6,
  /**
   * An `--edge-cache-path` never HIT the Workers Cache, or an
   * `--edge-uncached-path` did (narduk-libs#435).
   */
  edgeCacheFailed: 7,
} as const

export type VerifyAssertionId =
  | 'origin'
  | 'build-version'
  | 'health'
  | 'smoke'
  | 'edge-cache'
  | 'edge-uncached'
  /**
   * The system resolver had no address for the host but public DNS did: a stale
   * local negative answer, always `unknown` and exit 2 (narduk-libs#783).
   */
  | 'dns'
export type VerifyAssertionStatus = 'pass' | 'fail' | 'unknown' | 'skipped'

export interface VerifyAssertion {
  id: VerifyAssertionId
  status: VerifyAssertionStatus
  detail: string
  /** The exit code this assertion owns when it is the one that failed. */
  exitCode: number
  evidence?: Record<string, unknown>
}

export interface VerifyAttempt {
  attempt: number
  assertions: VerifyAssertion[]
}

export interface VerifyReport {
  schemaVersion: 1
  tool: '@narduk-enterprises/narduk-app-tools/verify-live'
  generated: string
  baseUrl: string
  expectedSha: string | null
  expectedBuildId?: string | null
  attemptsUsed: number
  attemptsAllowed: number
  /** Present only when the probes went through `--resolver public`. */
  resolver?: 'public'
  assertions: VerifyAssertion[]
  result: 'PASS' | 'FAIL'
  exitCode: number
}

export interface VerifyFlags {
  baseUrl: string
  expectSha: string | null
  /** Local snapshots have identities distinct from their base commit. Exact match only. */
  expectBuildId?: string | null
  buildVersionHeader: string
  healthPath: string | null
  smokePath: string | null
  expectContentType: string
  attempts: number
  intervalSeconds: number
  timeoutMs: number
  /** Overall proof budget, including requests and retry delays. */
  deadlineMs?: number
  allowDegraded: boolean
  /** Add a per-run query parameter so no cache key can be shared with a browser's. */
  cacheBust: boolean
  /** Routes whose second GET must be an edge cache HIT (a `live`/`slow` profile). */
  edgeCachePaths: string[]
  /** Routes that must never HIT (`none`, a thrown error, a preference-shaped response). */
  edgeUncachedPaths: string[]
  json: boolean
  jsonPath: string | null
  /**
   * Environment variable NAMES holding a Cloudflare Access service token, for
   * a host whose every path (health included) sits behind Access. Names, not
   * values: a secret on argv lands in process listings and CI logs.
   */
  accessClientIdEnv: string | null
  accessClientSecretEnv: string | null
  /**
   * `system` (default) resolves the host like any other process. `public` dials
   * an address from 1.1.1.1 / 8.8.8.8 instead, keeping the hostname for SNI and
   * `Host` -- for a workstation holding a stale negative DNS answer.
   */
  resolver?: VerifyResolverMode
}

export const DEFAULT_VERIFY_FLAGS = {
  buildVersionHeader: 'x-build-version',
  healthPath: '/api/health',
  smokePath: '/',
  expectContentType: 'text/html',
  attempts: 6,
  intervalSeconds: 10,
  timeoutMs: 15_000,
  deadlineMs: 180_000,
} as const

const SHA_PATTERN = /^[a-f\d]{7,64}$/iu

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function requirePositiveInteger(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

function assertHttpUrl(value: string, flag: string): void {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
  } catch {
    throw new Error(`${flag} must be an http(s) URL, got ${JSON.stringify(value)}`)
  }
}

const ENV_NAME_PATTERN = /^[A-Z_][A-Z\d_]*$/u

function requireEnvName(value: string, flag: string): string {
  if (!ENV_NAME_PATTERN.test(value)) {
    throw new Error(
      `${flag} takes an environment variable NAME (e.g. CF_ACCESS_CLIENT_ID), not a value`,
    )
  }
  return value
}

/**
 * The Cloudflare Access service-token headers, read from the environment
 * variables the flags name. Fails closed on an unset, empty or whitespace-only
 * variable, and the error names the variable, never its value.
 */
export function resolveAccessHeaders(
  flags: Pick<VerifyFlags, 'accessClientIdEnv' | 'accessClientSecretEnv'>,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> | undefined {
  if (flags.accessClientIdEnv === null || flags.accessClientSecretEnv === null) return undefined
  const id = env[flags.accessClientIdEnv]
  const secret = env[flags.accessClientSecretEnv]
  for (const [name, value] of [
    [flags.accessClientIdEnv, id],
    [flags.accessClientSecretEnv, secret],
  ] as const) {
    if (!value?.trim())
      throw new Error(`verify --live: environment variable ${name} is unset or empty`)
  }
  return { 'cf-access-client-id': id!, 'cf-access-client-secret': secret! }
}

/**
 * Accepts both spellings the design and the brief use: `verify --live <url>`
 * and `verify --live --base-url <url>`. `--live` is the mode, not the value,
 * so it also takes a bare form.
 */
export function parseVerifyArgs(args: string[]): VerifyFlags {
  let live = false
  let baseUrl: string | null = null
  const flags: Omit<VerifyFlags, 'baseUrl'> = {
    expectSha: null,
    expectBuildId: null,
    buildVersionHeader: DEFAULT_VERIFY_FLAGS.buildVersionHeader,
    healthPath: DEFAULT_VERIFY_FLAGS.healthPath,
    smokePath: DEFAULT_VERIFY_FLAGS.smokePath,
    expectContentType: DEFAULT_VERIFY_FLAGS.expectContentType,
    attempts: DEFAULT_VERIFY_FLAGS.attempts,
    intervalSeconds: DEFAULT_VERIFY_FLAGS.intervalSeconds,
    timeoutMs: DEFAULT_VERIFY_FLAGS.timeoutMs,
    deadlineMs: DEFAULT_VERIFY_FLAGS.deadlineMs,
    allowDegraded: false,
    cacheBust: true,
    edgeCachePaths: [],
    edgeUncachedPaths: [],
    json: false,
    jsonPath: null,
    accessClientIdEnv: null,
    accessClientSecretEnv: null,
    resolver: 'system',
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--live') {
      live = true
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        baseUrl = next
        index += 1
      }
    } else if (arg === '--base-url') baseUrl = requireValue(args, (index += 1), '--base-url')
    else if (arg === '--expect-sha')
      flags.expectSha = requireValue(args, (index += 1), '--expect-sha')
    else if (arg === '--expect-build-id')
      flags.expectBuildId = requireValue(args, (index += 1), '--expect-build-id')
    else if (arg === '--build-version-header')
      flags.buildVersionHeader = requireValue(
        args,
        (index += 1),
        '--build-version-header',
      ).toLowerCase()
    else if (arg === '--health-path')
      flags.healthPath = requireValue(args, (index += 1), '--health-path')
    else if (arg === '--no-health') flags.healthPath = null
    else if (arg === '--smoke-path')
      flags.smokePath = requireValue(args, (index += 1), '--smoke-path')
    else if (arg === '--no-smoke') flags.smokePath = null
    else if (arg === '--expect-content-type')
      flags.expectContentType = requireValue(args, (index += 1), '--expect-content-type')
    else if (arg === '--attempts')
      flags.attempts = requirePositiveInteger(
        requireValue(args, (index += 1), '--attempts'),
        '--attempts',
      )
    else if (arg === '--interval-seconds') {
      const raw = requireValue(args, (index += 1), '--interval-seconds')
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `--interval-seconds must be a non-negative number, got ${JSON.stringify(raw)}`,
        )
      }
      flags.intervalSeconds = value
    } else if (arg === '--timeout-ms')
      flags.timeoutMs = requirePositiveInteger(
        requireValue(args, (index += 1), '--timeout-ms'),
        '--timeout-ms',
      )
    else if (arg === '--deadline-ms')
      flags.deadlineMs = requirePositiveInteger(
        requireValue(args, (index += 1), '--deadline-ms'),
        '--deadline-ms',
      )
    else if (arg === '--allow-degraded') flags.allowDegraded = true
    else if (arg === '--no-cache-bust') flags.cacheBust = false
    else if (arg === '--edge-cache-path')
      flags.edgeCachePaths.push(requireValue(args, (index += 1), '--edge-cache-path'))
    else if (arg === '--edge-uncached-path')
      flags.edgeUncachedPaths.push(requireValue(args, (index += 1), '--edge-uncached-path'))
    else if (arg === '--access-client-id-env')
      flags.accessClientIdEnv = requireEnvName(
        requireValue(args, (index += 1), '--access-client-id-env'),
        '--access-client-id-env',
      )
    else if (arg === '--access-client-secret-env')
      flags.accessClientSecretEnv = requireEnvName(
        requireValue(args, (index += 1), '--access-client-secret-env'),
        '--access-client-secret-env',
      )
    else if (arg === '--resolver') {
      const value = requireValue(args, (index += 1), '--resolver')
      if (!VERIFY_RESOLVER_MODES.includes(value as VerifyResolverMode)) {
        throw new Error(`--resolver must be system or public, got ${JSON.stringify(value)}`)
      }
      flags.resolver = value as VerifyResolverMode
    } else if (arg === '--json') {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) {
        flags.jsonPath = next
        index += 1
      } else {
        flags.json = true
      }
    } else throw new Error(`Unknown verify option: ${arg}`)
  }
  if (!live) throw new Error('Usage: narduk-app verify --live <url> [options]')
  if (!baseUrl) throw new Error('verify --live needs a base URL: --live <url> or --base-url <url>')
  assertHttpUrl(baseUrl, '--base-url')
  if ((flags.accessClientIdEnv === null) !== (flags.accessClientSecretEnv === null)) {
    throw new Error(
      '--access-client-id-env and --access-client-secret-env go together; a service token is both halves',
    )
  }
  if (flags.expectSha && !SHA_PATTERN.test(flags.expectSha)) {
    throw new Error(`--expect-sha must be a hex commit SHA, got ${JSON.stringify(flags.expectSha)}`)
  }
  if (flags.expectSha && flags.expectBuildId) {
    throw new Error('--expect-sha and --expect-build-id are mutually exclusive')
  }
  if (flags.expectBuildId && !/^[A-Za-z0-9][\w.-]{0,199}$/u.test(flags.expectBuildId)) {
    throw new Error('--expect-build-id must be a nonempty identifier of at most 200 characters')
  }
  if (
    flags.healthPath === null &&
    flags.smokePath === null &&
    !flags.expectSha &&
    !flags.expectBuildId &&
    flags.edgeCachePaths.length === 0 &&
    flags.edgeUncachedPaths.length === 0
  ) {
    throw new Error('verify --live needs at least one assertion; nothing was enabled')
  }
  return { ...flags, baseUrl }
}

/** Prefix compare in both directions -- see the module comment. */
export function buildVersionMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false
  const a = expected.trim().toLowerCase()
  const b = actual.trim().toLowerCase()
  if (!SHA_PATTERN.test(a) || !SHA_PATTERN.test(b)) return false
  return a.startsWith(b) || b.startsWith(a)
}

/** The narduk-core `/api/health` envelope, as much of it as this proof reads. */
export interface HealthEnvelope {
  success?: boolean
  data?: {
    status?: string
    database?: string
    missingAuthTables?: string[]
    checks?: Array<{ name?: string; required?: boolean; result?: string; error?: string }>
  }
}

/**
 * The `DatabaseHealthStatus` values that mean the database is not usable
 * (`packages/modules/narduk-core/runtime/server/health/report.ts`). `ok` and
 * `not_applicable` are the two that are fine -- the second is an app that
 * declared `databaseBackend: 'none'` on purpose.
 */
export const BROKEN_DATABASE_STATUSES = new Set(['not_available', 'schema_error', 'error'])

export function assessHealth(
  response: LiveResponse,
  options: { allowDegraded: boolean },
): VerifyAssertion {
  const base = { id: 'health' as const, exitCode: VERIFY_EXIT.healthFailed }
  if (response.error !== undefined || response.status === undefined) {
    return {
      ...base,
      status: 'unknown',
      detail: `Could not read ${response.url}: ${response.error ?? 'no response'}`,
      exitCode: VERIFY_EXIT.unreachable,
    }
  }
  let envelope: HealthEnvelope
  try {
    envelope = JSON.parse(response.body ?? '') as HealthEnvelope
  } catch {
    return {
      ...base,
      status: 'fail',
      detail: `${response.url} answered ${String(response.status)} with a body that is not JSON`,
      evidence: { status: response.status },
    }
  }
  const report = envelope.data
  if (!report || typeof report.status !== 'string') {
    return {
      ...base,
      status: 'fail',
      detail: `${response.url} did not answer with the narduk-core health envelope { success, data: { status, checks } }`,
      evidence: { status: response.status },
    }
  }
  const checks = report.checks ?? []
  const failedRequired = checks.filter(
    (check) => check.required === true && check.result !== 'pass' && check.result !== 'skipped',
  )
  const evidence = {
    httpStatus: response.status,
    healthStatus: report.status,
    database: report.database,
    failedRequired: failedRequired.map((check) => check.name ?? '(unnamed)'),
  }
  if (failedRequired.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail: `required health check(s) not passing: ${evidence.failedRequired.join(', ')}`,
      evidence,
    }
  }
  if (report.status === 'ok') {
    return {
      ...base,
      status: 'pass',
      detail: 'health status ok, every required check passing',
      evidence,
    }
  }
  if (report.status === 'degraded') {
    // `--allow-degraded` is for an app whose *optional* checks flap. It is not a
    // licence to ship without a database: narduk-core reports a missing D1
    // binding as `required: false` when the app never declared
    // `databaseBackend` (`runtime/server/health/report.ts`
    // `reportMissingD1Binding`), so a release whose `DB` binding was dropped
    // summarises to `degraded` and would otherwise be waved through with
    // `data.database === "not_available"`.
    if (options.allowDegraded && report.database && BROKEN_DATABASE_STATUSES.has(report.database)) {
      return {
        ...base,
        status: 'fail',
        detail:
          `health status degraded with database ${report.database}. --allow-degraded covers a ` +
          'flapping optional check, never a missing or broken database binding.',
        evidence,
      }
    }
    return options.allowDegraded
      ? {
          ...base,
          status: 'pass',
          detail: 'health status degraded, accepted by --allow-degraded (optional check failing)',
          evidence,
        }
      : {
          ...base,
          status: 'fail',
          detail:
            'health status degraded: an optional check is failing. Design §6.2 requires status ok; ' +
            'pass --allow-degraded to accept degraded as proof.',
          evidence,
        }
  }
  return {
    ...base,
    status: 'fail',
    detail: `health status ${report.status}`,
    evidence,
  }
}

export function assessBuildVersion(
  response: LiveResponse,
  expectedSha: string,
  header: string,
  comparison: 'sha-prefix' | 'exact' = 'sha-prefix',
): VerifyAssertion {
  const base = { id: 'build-version' as const, exitCode: VERIFY_EXIT.buildVersionMismatch }
  if (response.error !== undefined || response.status === undefined) {
    return {
      ...base,
      status: 'unknown',
      detail: `Could not read ${response.url}: ${response.error ?? 'no response'}`,
      exitCode: VERIFY_EXIT.unreachable,
    }
  }
  const actual = response.headers?.[header]
  if (!actual) {
    return {
      ...base,
      status: 'fail',
      detail: `${response.url} served no ${header} header; narduk-core publishes it from runtimeConfig.public.buildVersion`,
      evidence: { httpStatus: response.status },
    }
  }
  return (
    comparison === 'exact' ? expectedSha === actual : buildVersionMatches(expectedSha, actual)
  )
    ? {
        ...base,
        status: 'pass',
        detail: `${header} ${actual} matches ${expectedSha}`,
        evidence: { header, actual, expected: expectedSha },
      }
    : {
        ...base,
        status: 'fail',
        detail: `${header} is ${actual}, expected ${expectedSha}`,
        evidence: { header, actual, expected: expectedSha },
      }
}

export function assessSmoke(response: LiveResponse, expectContentType: string): VerifyAssertion {
  const base = { id: 'smoke' as const, exitCode: VERIFY_EXIT.smokeFailed }
  if (response.error !== undefined || response.status === undefined) {
    return {
      ...base,
      status: 'unknown',
      detail: `Could not read ${response.url}: ${response.error ?? 'no response'}`,
      exitCode: VERIFY_EXIT.unreachable,
    }
  }
  if (response.status < 200 || response.status > 299) {
    return {
      ...base,
      status: 'fail',
      detail: `${response.url} answered ${String(response.status)}, expected 2xx`,
      evidence: { httpStatus: response.status },
    }
  }
  const contentType = response.headers?.['content-type'] ?? ''
  if (!contentType.toLowerCase().includes(expectContentType.toLowerCase())) {
    return {
      ...base,
      status: 'fail',
      detail: `${response.url} content-type ${contentType || '(absent)'} does not contain ${expectContentType}`,
      evidence: { httpStatus: response.status, contentType },
    }
  }
  return {
    ...base,
    status: 'pass',
    detail: `${response.url} ${String(response.status)} ${contentType}`,
    evidence: { httpStatus: response.status, contentType },
  }
}

/**
 * `Cf-Cache-Status` values that mean the response came out of the cache rather
 * than from the Worker. `HIT` is the ordinary one; `STALE`, `UPDATING` and
 * `REVALIDATED` are stored responses served under `stale-while-revalidate` or a
 * conditional revalidation, which are just as much proof that the edge stores
 * the route. Everything else (`MISS`, `EXPIRED`, `BYPASS`, `DYNAMIC`, absent)
 * means the Worker answered.
 *
 * @see https://developers.cloudflare.com/workers/cache/debugging/
 */
export const STORED_CACHE_STATUSES = new Set(['HIT', 'STALE', 'UPDATING', 'REVALIDATED'])

function cacheStatusOf(response: LiveResponse): string | undefined {
  return response.headers?.['cf-cache-status']?.trim().toUpperCase()
}

function unreadable(
  id: 'edge-cache' | 'edge-uncached',
  response: LiveResponse,
): VerifyAssertion | null {
  if (response.error === undefined && response.status !== undefined) return null
  return {
    id,
    status: 'unknown',
    detail: `Could not read ${response.url}: ${response.error ?? 'no response'}`,
    exitCode: VERIFY_EXIT.unreachable,
  }
}

/**
 * Two GETs of one URL, the second of which must come from the Workers Cache.
 *
 * A `private`/`no-store` answer is `unknown`, not `fail`: that is what a
 * preview-safe hostname (`*.workers.dev`, where narduk-core forces every
 * profile to `none`) or a suppression guard legitimately serves, and it means
 * the proof has to run against the production hostname instead.
 */
export function assessEdgeCache(first: LiveResponse, second: LiveResponse): VerifyAssertion {
  const base = { id: 'edge-cache' as const, exitCode: VERIFY_EXIT.edgeCacheFailed }
  const failed = unreadable('edge-cache', first) ?? unreadable('edge-cache', second)
  if (failed) return failed
  const statuses = [cacheStatusOf(first), cacheStatusOf(second)]
  const cacheControl = second.headers?.['cache-control'] ?? ''
  const evidence = {
    httpStatus: second.status,
    cfCacheStatus: statuses.map((status) => status ?? null),
    cacheControl: cacheControl || null,
    cdnCacheControl: second.headers?.['cdn-cache-control'] ?? null,
  }
  if (second.status === undefined || second.status < 200 || second.status > 299) {
    return {
      ...base,
      status: 'fail',
      detail: `${second.url} answered ${String(second.status)}; only a 2xx can prove a HIT`,
      evidence,
    }
  }
  if (/\b(?:private|no-store)\b/iu.test(cacheControl)) {
    return {
      ...base,
      status: 'unknown',
      detail:
        `${second.url} is Cache-Control: ${cacheControl}, so this origin cannot prove a HIT here ` +
        '-- preview-safe mode (a *.workers.dev or preview hostname) or a setCacheProfile guard ' +
        'forced it private. Run the edge proof against the production hostname.',
      evidence,
    }
  }
  if (statuses[1] && STORED_CACHE_STATUSES.has(statuses[1])) {
    return {
      ...base,
      status: 'pass',
      detail: `${second.url} second GET served from the edge cache (Cf-Cache-Status: ${statuses[1]})`,
      evidence,
    }
  }
  if (!statuses[0] && !statuses[1]) {
    return {
      ...base,
      status: 'fail',
      detail:
        `${second.url} carries no Cf-Cache-Status, so the Worker ran both times: Workers Cache is ` +
        'not on. Add "cache": { "enabled": true } to the wrangler config (Wrangler >= 4.69.0).',
      evidence,
    }
  }
  return {
    ...base,
    status: 'fail',
    detail:
      `${second.url} second GET was Cf-Cache-Status: ${statuses[1] ?? '(absent)'}, not a HIT. ` +
      'Workers Cache is answering but did not store this response.',
    evidence,
  }
}

/** Two GETs of one URL, neither of which may come from the cache. */
export function assessEdgeUncached(first: LiveResponse, second: LiveResponse): VerifyAssertion {
  const base = { id: 'edge-uncached' as const, exitCode: VERIFY_EXIT.edgeCacheFailed }
  const failed = unreadable('edge-uncached', first) ?? unreadable('edge-uncached', second)
  if (failed) return failed
  const statuses = [cacheStatusOf(first), cacheStatusOf(second)]
  const evidence = {
    httpStatus: second.status,
    cfCacheStatus: statuses.map((status) => status ?? null),
    cacheControl: second.headers?.['cache-control'] ?? null,
  }
  const stored = statuses.find((status) => status && STORED_CACHE_STATUSES.has(status))
  if (stored) {
    return {
      ...base,
      status: 'fail',
      detail:
        `${second.url} was served from the edge cache (Cf-Cache-Status: ${stored}); this route ` +
        'must never be stored -- one visitor’s response is being replayed to others.',
      evidence,
    }
  }
  return {
    ...base,
    status: 'pass',
    detail: `${second.url} not served from cache (Cf-Cache-Status: ${statuses[1] ?? '(absent)'})`,
    evidence,
  }
}

/**
 * Did the request stay on the origin we were asked about?
 *
 * Redirects are followed -- an apex that 308s to `www`, or `/` to `/en`, is
 * ordinary and the app is the same app. A redirect to a *different origin* is
 * not ordinary: design §2.3's named hazard is two Workers in two accounts
 * answering one hostname, and every later assertion in this pass would then be
 * describing the other one. `null` when nothing redirected.
 */
export function assessOrigin(response: LiveResponse, baseUrl: string): VerifyAssertion | null {
  if (!response.redirected || !response.finalUrl) return null
  const base = { id: 'origin' as const, exitCode: VERIFY_EXIT.offOrigin }
  let expected: string
  let actual: string
  try {
    expected = new URL(baseUrl).origin
    actual = new URL(response.finalUrl).origin
  } catch {
    return {
      ...base,
      status: 'fail',
      detail: `Could not compare the final URL ${response.finalUrl} against ${baseUrl}`,
      evidence: { finalUrl: response.finalUrl },
    }
  }
  if (expected === actual) return null
  return {
    ...base,
    status: 'fail',
    detail:
      `the request to ${response.url} was answered by ${actual}, not ${expected}. Every other ` +
      'assertion in this pass describes that other origin, so this is not a proof of the ' +
      'deployment under test.',
    evidence: { requested: response.url, finalUrl: response.finalUrl, expected, actual },
  }
}

/**
 * The exit code of a whole pass: the failing assertion's own code, in severity
 * order. A wrong origin beats everything -- the other answers are about some
 * other deployment. Then unreachable beats a wrong build beats an unhealthy app
 * beats a broken smoke route, because each later answer is only meaningful once
 * the earlier one holds.
 */
export function resolveExitCode(assertions: readonly VerifyAssertion[]): number {
  const offOrigin = assertions.find((entry) => entry.id === 'origin' && entry.status === 'fail')
  if (offOrigin) return VERIFY_EXIT.offOrigin
  const order: VerifyAssertionId[] = [
    'build-version',
    'health',
    'smoke',
    'edge-cache',
    'edge-uncached',
  ]
  const unreachable = assertions.find((assertion) => assertion.exitCode === VERIFY_EXIT.unreachable)
  if (unreachable && unreachable.status !== 'pass') return VERIFY_EXIT.unreachable
  for (const id of order) {
    const assertion = assertions.find((entry) => entry.id === id)
    if (assertion && (assertion.status === 'fail' || assertion.status === 'unknown')) {
      return assertion.exitCode
    }
  }
  return VERIFY_EXIT.pass
}

export interface VerifyContext {
  probe?: LiveProbe
  /** Monotonic clock; injected with sleep in deadline tests. */
  now?: () => number
  /** Injected in tests so a retry loop costs no wall time. */
  sleep?: (ms: number) => Promise<void>
  generated?: string
  onAttempt?: (attempt: VerifyAttempt) => void
  /** Injected in tests so the cache-busting URL is deterministic. */
  cacheBustToken?: (attempt: number) => string
  /** Where the Access service-token variables are read from; process.env by default. */
  env?: Record<string, string | undefined>
  /**
   * Public-DNS lookup for the stale-negative-cache diagnosis and for
   * `--resolver public`; `node:dns` pinned to 1.1.1.1 / 8.8.8.8 by default.
   */
  resolvePublic?: PublicResolve
}

/** The query parameter name the cache buster uses. */
export const CACHE_BUST_PARAM = '_nardukProof'

/**
 * A URL no intermediary can already hold a cached copy of. The value is unique
 * per attempt, not per run: a retry exists because the promotion had not
 * propagated on the previous try, and reusing the first attempt's key would let
 * the first answer be served back for the whole window.
 */
export function cacheBustedUrl(url: string, token: string, enabled: boolean): string {
  if (!enabled) return url
  const parsed = new URL(url)
  parsed.searchParams.set(CACHE_BUST_PARAM, token)
  return parsed.toString()
}

async function runOnce(
  flags: VerifyFlags,
  rawProbe: LiveProbe,
  token: string,
  headers: Record<string, string> | undefined,
): Promise<VerifyAssertion[]> {
  const probe: LiveProbe = headers
    ? (url, options = {}) => rawProbe(url, { ...options, headers })
    : rawProbe
  const assertions: VerifyAssertion[] = []
  const base = new URL(flags.baseUrl)
  const bust = (url: string): string => cacheBustedUrl(url, token, flags.cacheBust)
  // The build-version header and the smoke route are read from ONE request:
  // `x-build-version` is on every response, so probing the smoke path twice
  // would only double the load on a deployment that is already under proof.
  if (flags.expectSha || flags.expectBuildId || flags.smokePath) {
    const url = bust(new URL(flags.smokePath ?? '/', base).toString())
    const response = await probe(url, { timeoutMs: flags.timeoutMs })
    const origin = assessOrigin(response, flags.baseUrl)
    if (origin) assertions.push(origin)
    if (flags.expectSha) {
      assertions.push(assessBuildVersion(response, flags.expectSha, flags.buildVersionHeader))
    }
    if (flags.expectBuildId) {
      assertions.push(
        assessBuildVersion(response, flags.expectBuildId, flags.buildVersionHeader, 'exact'),
      )
    }
    if (flags.smokePath) {
      assertions.push(assessSmoke(response, flags.expectContentType))
    }
  }
  if (flags.healthPath) {
    const url = bust(new URL(flags.healthPath, base).toString())
    const response = await probe(url, { readBody: true, timeoutMs: flags.timeoutMs })
    const origin = assessOrigin(response, flags.baseUrl)
    if (origin && !assertions.some((entry) => entry.id === 'origin')) assertions.push(origin)
    assertions.push(assessHealth(response, { allowDegraded: flags.allowDegraded }))
  }
  // The edge proof must look like a visitor: no no-cache request headers, and
  // the same URL twice. With the cache buster on, that URL is fresh for this
  // attempt, so the first GET cannot already be warm and a HIT on the second
  // is this run's own store, not a previous release's.
  const twice = async (path: string): Promise<[LiveResponse, LiveResponse]> => {
    const url = bust(new URL(path, base).toString())
    const first = await probe(url, { noCache: false, timeoutMs: flags.timeoutMs })
    const second = await probe(url, { noCache: false, timeoutMs: flags.timeoutMs })
    return [first, second]
  }
  for (const path of flags.edgeCachePaths) {
    const [first, second] = await twice(path)
    const origin = assessOrigin(second, flags.baseUrl)
    if (origin && !assertions.some((entry) => entry.id === 'origin')) assertions.push(origin)
    assertions.push(assessEdgeCache(first, second))
  }
  for (const path of flags.edgeUncachedPaths) {
    const [first, second] = await twice(path)
    const origin = assessOrigin(second, flags.baseUrl)
    if (origin && !assertions.some((entry) => entry.id === 'origin')) assertions.push(origin)
    assertions.push(assessEdgeUncached(first, second))
  }
  return assertions
}

export async function runVerifyLive(
  flags: VerifyFlags,
  context: VerifyContext = {},
): Promise<VerifyReport> {
  if (flags.expectSha && flags.expectBuildId) {
    throw new Error('--expect-sha and --expect-build-id are mutually exclusive')
  }
  const now = context.now ?? (() => performance.now())
  const deadline = now() + (flags.deadlineMs ?? DEFAULT_VERIFY_FLAGS.deadlineMs)
  const resolverMode = flags.resolver ?? 'system'
  const dns = createDnsDiagnoser({
    mode: resolverMode,
    exitCode: VERIFY_EXIT.unreachable,
    resolvePublic: context.resolvePublic,
  })
  const rawProbe = dns.wrap(
    context.probe ??
      createResolverProbe(resolverMode, {
        timeoutMs: flags.timeoutMs,
        resolvePublic: context.resolvePublic,
      }),
  )
  const probe: LiveProbe = async (url, options = {}) => {
    const remaining = Math.floor(deadline - now())
    if (remaining <= 0) return { url, error: 'Overall live-proof deadline exceeded' }
    const response = await rawProbe(url, {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? flags.timeoutMs, remaining),
    })
    return now() > deadline ? { url, error: 'Overall live-proof deadline exceeded' } : response
  }
  const accessHeaders = resolveAccessHeaders(flags, context.env)
  const sleep = context.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  let assertions: VerifyAssertion[] = []
  let attempt = 0
  let exitCode: number = VERIFY_EXIT.pass
  const token =
    context.cacheBustToken ??
    ((n: number) =>
      `${Date.now().toString(36)}-${String(n)}-${Math.random().toString(36).slice(2, 8)}`)
  while (attempt < flags.attempts) {
    attempt += 1
    assertions = dns.annotate(await runOnce(flags, probe, token(attempt), accessHeaders))
    context.onAttempt?.({ attempt, assertions })
    exitCode = resolveExitCode(assertions)
    if (exitCode === VERIFY_EXIT.pass) break
    if (attempt < flags.attempts) {
      const remaining = deadline - now()
      if (remaining <= 0) break
      await sleep(Math.min(flags.intervalSeconds * 1000, remaining))
      if (now() >= deadline) break
    }
  }
  return {
    schemaVersion: 1,
    tool: '@narduk-enterprises/narduk-app-tools/verify-live',
    generated: context.generated ?? new Date().toISOString(),
    baseUrl: flags.baseUrl,
    expectedSha: flags.expectSha,
    expectedBuildId: flags.expectBuildId ?? null,
    attemptsUsed: attempt,
    attemptsAllowed: flags.attempts,
    ...(resolverMode === 'public' ? { resolver: 'public' as const } : {}),
    assertions,
    result: exitCode === VERIFY_EXIT.pass ? 'PASS' : 'FAIL',
    exitCode,
  }
}

export function formatVerifyReport(report: VerifyReport): string {
  const lines = [
    `narduk-app verify --live ${report.baseUrl}`,
    `  expected   ${report.expectedBuildId ?? report.expectedSha ?? '(no build identity assertion)'}`,
    `  attempts   ${String(report.attemptsUsed)} of ${String(report.attemptsAllowed)}`,
  ]
  if (report.resolver === 'public') {
    lines.push(`  resolver   public (${PUBLIC_RESOLVERS.join(', ')}), SNI and Host kept`)
  }
  lines.push('')
  for (const assertion of report.assertions) {
    const mark =
      assertion.status === 'pass'
        ? 'PASS'
        : assertion.status === 'fail'
          ? 'FAIL'
          : assertion.status === 'unknown'
            ? 'UNKN'
            : 'SKIP'
    lines.push(`  [${mark}] ${assertion.id}: ${assertion.detail}`)
  }
  lines.push('')
  lines.push(`RESULT: ${report.result} (exit ${String(report.exitCode)})`)
  return lines.join('\n')
}
