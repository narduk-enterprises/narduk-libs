/**
 * Route-free preview identity: converge first, then diagnose everything.
 *
 * A fixed Workers preview alias is eventually consistent after upload. One
 * no-store read can still see the previous SHA after the provider inventory
 * already contains the new version (BorderWait / SpaceX, 2026-07-30). This
 * helper polls until the expected identity is stable for a configurable
 * number of consecutive reads, then evaluates every safe HTTP assertion and
 * returns all mismatches together (narduk-libs#47).
 *
 * Read-only. No upload, promotion, rollback, traffic mutation, or credential
 * persistence.
 */

import { createLiveProbe, type LiveProbe, type LiveResponse } from './live-probe.js'
import {
  bindWorkerIdentity,
  describeIdentityBinding,
  identityMatches,
  readRuntimeIdentity,
  type ExpectedIdentity,
  type IdentityBindingResult,
  type RuntimeIdentity,
} from './worker-identity.js'

import type { WorkerVersion } from './promote.js'

export const DEFAULT_ALIAS_CONSECUTIVE = 3
export const DEFAULT_ALIAS_TIMEOUT_MS = 30_000
export const DEFAULT_ALIAS_INTERVAL_MS = 200

export interface SanitizedObservation {
  attempt: number
  status?: number
  sha: string | null
  versionId: string | null
  cacheControl?: string
  robotsTag?: string
  error?: string
  matched: boolean
}

export interface AliasConvergence {
  converged: boolean
  consecutiveMatched: number
  observations: SanitizedObservation[]
  binding: IdentityBindingResult | null
}

export interface PreviewRouteExpectation {
  path: string
  status: number
  contentType?: string
}

export interface PreviewRedirectExpectation {
  path: string
  to?: string
  status?: number
  none?: boolean
}

export interface PreviewDiagnosticSpec {
  routes?: PreviewRouteExpectation[]
  redirects?: PreviewRedirectExpectation[]
  cacheControlIncludes?: string[]
  robotsHeader?: string
  robotsMeta?: string
  health?: {
    path?: string
    status?: string
    fields?: Record<string, unknown>
  }
}

export interface PreviewProofMismatch {
  id: string
  detail: string
  evidence?: Record<string, unknown>
}

export interface PreviewProofResult {
  converged: boolean
  binding: IdentityBindingResult | null
  observations: SanitizedObservation[]
  mismatches: PreviewProofMismatch[]
  result: 'PASS' | 'FAIL'
}

export interface ConvergenceOptions {
  url: string
  expected: ExpectedIdentity
  inventory: readonly WorkerVersion[]
  consecutive?: number
  timeoutMs?: number
  intervalMs?: number
  probe?: LiveProbe
  readIdentity?: (response: LiveResponse) => RuntimeIdentity
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface PreviewProofOptions extends Omit<ConvergenceOptions, 'url'> {
  origin: string
  url?: string
  identityPath?: string
  diagnostics?: PreviewDiagnosticSpec
}

const SENSITIVE_HEADER = /^(?:authorization|cookie|set-cookie|cf-access-|x-api-key)/iu

function requirePositiveFinite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return value
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function sanitizeObservation(
  attempt: number,
  response: LiveResponse,
  identity: RuntimeIdentity,
  matched: boolean,
): SanitizedObservation {
  const headers = response.headers ?? {}
  const observation: SanitizedObservation = {
    attempt,
    sha: identity.sha ?? null,
    versionId: identity.versionId ?? null,
    matched,
  }
  if (response.status !== undefined) observation.status = response.status
  if (response.error) observation.error = response.error
  const cacheControl = headers['cache-control']
  if (cacheControl && !SENSITIVE_HEADER.test('cache-control')) {
    observation.cacheControl = cacheControl
  }
  const robots = headers['x-robots-tag']
  if (robots) observation.robotsTag = robots
  return observation
}

function observationsLeakSecrets(observations: readonly SanitizedObservation[]): boolean {
  return JSON.stringify(observations).includes('Bearer ')
}

export function convergeMatch(
  expected: ExpectedIdentity,
  runtime: RuntimeIdentity,
  inventory: readonly WorkerVersion[],
): IdentityBindingResult {
  return bindWorkerIdentity({ expected, runtime, inventory })
}

export async function convergeFixedAliasIdentity(
  options: ConvergenceOptions,
): Promise<AliasConvergence> {
  const consecutive = requirePositiveInteger(
    options.consecutive ?? DEFAULT_ALIAS_CONSECUTIVE,
    'consecutive',
  )
  const timeoutMs = requirePositiveFinite(
    options.timeoutMs ?? DEFAULT_ALIAS_TIMEOUT_MS,
    'timeoutMs',
  )
  const intervalMs = options.intervalMs ?? DEFAULT_ALIAS_INTERVAL_MS
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error('intervalMs must be a non-negative finite number')
  }
  const probe = options.probe ?? createLiveProbe({ noCache: true })
  const readIdentity = options.readIdentity ?? readRuntimeIdentity
  const now = options.now ?? (() => performance.now())
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + timeoutMs
  const observations: SanitizedObservation[] = []
  let streak = 0
  let lastBinding: IdentityBindingResult | null = null
  let attempt = 0
  while (now() < deadline) {
    attempt += 1
    const response = await probe(options.url, { readBody: true, noCache: true })
    const runtime = readIdentity(response)
    lastBinding = convergeMatch(options.expected, runtime, options.inventory)
    const matched = identityMatches(lastBinding)
    observations.push(sanitizeObservation(attempt, response, runtime, matched))
    streak = matched ? streak + 1 : 0
    if (streak >= consecutive) {
      return { converged: true, consecutiveMatched: streak, observations, binding: lastBinding }
    }
    if (now() + intervalMs >= deadline) break
    const beforeSleep = now()
    await sleep(intervalMs)
    // A clock that does not move (interval 0, or a test sleep that ignores 0)
    // must not spin until the process is killed.
    if (now() <= beforeSleep) break
  }
  return { converged: false, consecutiveMatched: streak, observations, binding: lastBinding }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function header(response: LiveResponse, name: string): string | undefined {
  return response.headers?.[name.toLowerCase()]
}

export function readRobotsMeta(html: string | undefined): string | null {
  if (!html) return null
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0]
    const attrs: Record<string, string> = {}
    for (const attr of tag.matchAll(/([a-z0-9:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? ''
    }
    const name = (attrs.name ?? attrs.property ?? '').toLowerCase()
    if (name === 'robots') return attrs.content ?? ''
  }
  return null
}

function tokenIncludes(actual: string | undefined, expected: string): boolean {
  if (!actual) return false
  const haystack = actual.toLowerCase()
  const needle = expected.trim().toLowerCase()
  return haystack.split(/[\s,]+/u).includes(needle) || haystack.includes(needle)
}

function joinUrl(origin: string, path: string): string {
  return new URL(path, origin).toString()
}

function parseJson(body: string | undefined): Record<string, unknown> | undefined {
  if (!body?.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function evaluatePreviewDiagnostics(
  origin: string,
  responses: Map<string, LiveResponse>,
  spec: PreviewDiagnosticSpec,
): PreviewProofMismatch[] {
  const mismatches: PreviewProofMismatch[] = []
  const read = (path: string): LiveResponse | undefined => responses.get(joinUrl(origin, path))

  for (const route of spec.routes ?? []) {
    const response = read(route.path)
    if (!response || response.error) {
      mismatches.push({
        id: `route:${route.path}`,
        detail: response?.error ?? `no response for ${route.path}`,
        evidence: { path: route.path },
      })
      continue
    }
    if (response.status !== route.status) {
      mismatches.push({
        id: `route:${route.path}`,
        detail: `${route.path} returned ${String(response.status)}, expected ${String(route.status)}`,
        evidence: { path: route.path, status: response.status, expected: route.status },
      })
    }
    if (route.contentType) {
      const actual = header(response, 'content-type') ?? ''
      if (!actual.toLowerCase().includes(route.contentType.toLowerCase())) {
        mismatches.push({
          id: `route-type:${route.path}`,
          detail: `${route.path} content-type ${actual || '(missing)'} does not include ${route.contentType}`,
          evidence: { path: route.path, contentType: actual, expected: route.contentType },
        })
      }
    }
  }

  for (const redirect of spec.redirects ?? []) {
    const response = read(redirect.path)
    if (!response || response.error) {
      mismatches.push({
        id: `redirect:${redirect.path}`,
        detail: response?.error ?? `no response for ${redirect.path}`,
        evidence: { path: redirect.path },
      })
      continue
    }
    if (redirect.none) {
      if (
        response.redirected ||
        (response.status !== undefined && response.status >= 300 && response.status < 400)
      ) {
        mismatches.push({
          id: `redirect:${redirect.path}`,
          detail: `${redirect.path} redirected to ${response.finalUrl ?? header(response, 'location') ?? '(unknown)'}`,
          evidence: { path: redirect.path, finalUrl: response.finalUrl, status: response.status },
        })
      }
      continue
    }
    if (redirect.status !== undefined && response.status !== redirect.status) {
      mismatches.push({
        id: `redirect-status:${redirect.path}`,
        detail: `${redirect.path} returned ${String(response.status)}, expected ${String(redirect.status)}`,
        evidence: { path: redirect.path, status: response.status, expected: redirect.status },
      })
    }
    if (redirect.to) {
      const actual = response.finalUrl ?? header(response, 'location') ?? ''
      if (!actual.includes(redirect.to)) {
        mismatches.push({
          id: `redirect:${redirect.path}`,
          detail: `${redirect.path} landed on ${actual || '(none)'}, expected to include ${redirect.to}`,
          evidence: { path: redirect.path, actual, expected: redirect.to },
        })
      }
    }
  }

  const cachePath = spec.health?.path ?? spec.routes?.[0]?.path ?? '/'
  const cacheResponse = read(cachePath) ?? read('/')
  if (spec.cacheControlIncludes && spec.cacheControlIncludes.length > 0) {
    const actual = header(cacheResponse ?? { url: origin }, 'cache-control')
    for (const token of spec.cacheControlIncludes) {
      if (!tokenIncludes(actual, token)) {
        mismatches.push({
          id: 'cache-policy',
          detail: `cache-control ${actual ?? '(missing)'} does not include ${token}`,
          evidence: { cacheControl: actual, expected: token },
        })
      }
    }
  }

  const robotsResponse = read('/') ?? cacheResponse
  if (spec.robotsHeader) {
    const actual = header(robotsResponse ?? { url: origin }, 'x-robots-tag')
    if (!tokenIncludes(actual, spec.robotsHeader)) {
      mismatches.push({
        id: 'robots-header',
        detail: `X-Robots-Tag ${actual ?? '(missing)'} does not include ${spec.robotsHeader}`,
        evidence: { header: actual, expected: spec.robotsHeader },
      })
    }
  }
  if (spec.robotsMeta) {
    const actual = readRobotsMeta(robotsResponse?.body)
    if (!tokenIncludes(actual ?? undefined, spec.robotsMeta)) {
      mismatches.push({
        id: 'robots-meta',
        detail: `robots meta ${actual ?? '(missing)'} does not include ${spec.robotsMeta}`,
        evidence: { meta: actual, expected: spec.robotsMeta },
      })
    }
  }

  if (spec.health) {
    const path = spec.health.path ?? '/api/health'
    const response = read(path)
    if (!response || response.error) {
      mismatches.push({
        id: 'health',
        detail: response?.error ?? `no response for ${path}`,
        evidence: { path },
      })
    } else {
      const payload = parseJson(response.body)
      const data = payload && isRecord(payload.data) ? payload.data : payload
      if (spec.health.status) {
        const actual = typeof data?.status === 'string' ? data.status : undefined
        if (actual !== spec.health.status) {
          mismatches.push({
            id: 'health-status',
            detail: `health status ${actual ?? '(missing)'} is not ${spec.health.status}`,
            evidence: { status: actual, expected: spec.health.status },
          })
        }
      }
      for (const [key, expected] of Object.entries(spec.health.fields ?? {})) {
        const actual = data?.[key]
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          mismatches.push({
            id: `health-field:${key}`,
            detail: `health.${key} ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`,
            evidence: { key, actual, expected },
          })
        }
      }
    }
  }

  return mismatches
}

export async function provePreviewIdentity(
  options: PreviewProofOptions,
): Promise<PreviewProofResult> {
  const origin = options.origin
  const identityPath = options.identityPath ?? '/api/health'
  const identityUrl = options.url ?? joinUrl(origin, identityPath)
  const convergence = await convergeFixedAliasIdentity({
    ...options,
    url: identityUrl,
  })
  const mismatches: PreviewProofMismatch[] = []
  if (!convergence.converged) {
    mismatches.push({
      id: 'identity-convergence',
      detail:
        `alias identity did not stay on the expected version/SHA for ` +
        `${String(options.consecutive ?? DEFAULT_ALIAS_CONSECUTIVE)} consecutive no-store reads`,
      evidence: { observations: convergence.observations },
    })
    return {
      converged: false,
      binding: convergence.binding,
      observations: convergence.observations,
      mismatches,
      result: 'FAIL',
    }
  }

  if (convergence.binding && !identityMatches(convergence.binding)) {
    mismatches.push({
      id: 'identity-binding',
      detail: describeIdentityBinding(convergence.binding),
      evidence: { binding: convergence.binding },
    })
  }

  const spec = options.diagnostics
  if (spec) {
    const probe = options.probe ?? createLiveProbe({ noCache: true })
    const paths = new Set<string>([identityPath, '/'])
    for (const route of spec.routes ?? []) paths.add(route.path)
    for (const redirect of spec.redirects ?? []) paths.add(redirect.path)
    if (spec.health?.path) paths.add(spec.health.path)
    const responses = new Map<string, LiveResponse>()
    for (const path of paths) {
      const url = joinUrl(origin, path)
      responses.set(
        url,
        await probe(url, {
          readBody: true,
          noCache: true,
        }),
      )
    }
    mismatches.push(...evaluatePreviewDiagnostics(origin, responses, spec))
  }

  if (observationsLeakSecrets(convergence.observations)) {
    mismatches.push({
      id: 'observation-sanitization',
      detail: 'sanitized observations must not carry credentials',
    })
  }

  return {
    converged: true,
    binding: convergence.binding,
    observations: convergence.observations,
    mismatches,
    result: mismatches.length === 0 ? 'PASS' : 'FAIL',
  }
}
