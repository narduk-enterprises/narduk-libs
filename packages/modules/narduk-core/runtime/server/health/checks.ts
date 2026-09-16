import type { H3Event } from 'h3'

/**
 * Registered application health checks for narduk-core's `/api/health`.
 *
 * This module is internal: apps call `registerHealthCheck` from
 * `server/utils/health-checks.ts`, and the health route runs what is registered.
 */

export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 3000
export const MAX_HEALTH_CHECK_TIMEOUT_MS = 30_000
/** Serialized `detail` above this size is omitted from the public report. */
export const MAX_HEALTH_CHECK_DETAIL_BYTES = 1024
/** Names of the built-in probes, which apps cannot register. */
export const RESERVED_HEALTH_CHECK_NAMES: readonly string[] = ['database', 'auth-tables']

const HEALTH_CHECK_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u
// Uptime monitors match raw substrings such as `"status":"ok"` and
// `"database":"ok"` anywhere in the body, so check details may not carry
// either key: a nested value must never be able to mask the top-level result.
const RESERVED_DETAIL_KEY_PATTERN = /"(?:status|database)":/u

export type HealthCheckDetail = Record<string, unknown>

export interface HealthCheckContext {
  event: H3Event
  /** Aborted when the check exceeds its timeout; pass it to `fetch` and similar calls. */
  signal: AbortSignal
}

export interface HealthCheckOutcome {
  /** `false` reports a failure without throwing. Omitted, the check passed. */
  ok?: boolean
  /**
   * A small JSON object published with the result, at most 1 KiB serialized.
   * Keys named `status` or `database`, at any depth, are rejected.
   */
  detail?: HealthCheckDetail
}

// `void` lets a check be a plain `async () => { ... }` that passes by resolving.
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type HealthCheckRunResult = HealthCheckOutcome | undefined | void

export interface HealthCheckDefinition {
  /** Lowercase letters, digits and hyphens; unique per app. */
  name: string
  /**
   * A required check that fails makes the whole report `error` (HTTP 503). An
   * optional check that fails makes it `degraded` (HTTP 200).
   */
  required: boolean
  /** Defaults to 3000 ms; at most 30000 ms. A timed-out check fails. */
  timeoutMs?: number
  /** Resolve (optionally with an outcome) to pass; throw or return `{ ok: false }` to fail. */
  run: (context: HealthCheckContext) => HealthCheckRunResult | Promise<HealthCheckRunResult>
}

export interface RegisteredHealthCheck extends HealthCheckDefinition {
  timeoutMs: number
}

export type HealthCheckResult = 'pass' | 'fail' | 'skipped'

export type HealthCheckDetailOmission = 'not-an-object' | 'not-serializable' | 'reserved-key' | 'too-large'

/** One entry of `data.checks` in the `/api/health` response. */
export interface HealthCheckReport {
  name: string
  required: boolean
  result: HealthCheckResult
  /** Why a check did not run. Present only when `result` is `skipped`. */
  reason?: string
  durationMs?: number
  /** Fixed public text for a failure; underlying errors go to the server log. */
  error?: string
  detail?: HealthCheckDetail
  /** Why a check's `detail` was left out of the public report. */
  detailOmitted?: HealthCheckDetailOmission
}

type HealthCheckRegistry = Map<string, RegisteredHealthCheck>

const REGISTRY_KEY = Symbol.for('@narduk-enterprises/narduk-core/health-checks')

/**
 * The per-isolate registry. It lives on `globalThis` so a duplicated module
 * instance in a bundle still shares one set of checks.
 */
export function getHealthCheckRegistry(): HealthCheckRegistry {
  const scope = globalThis as unknown as Record<symbol, HealthCheckRegistry | undefined>
  let registry = scope[REGISTRY_KEY]
  if (!registry) {
    registry = new Map()
    scope[REGISTRY_KEY] = registry
  }
  return registry
}

export function normalizeHealthCheckDefinition(
  definition: HealthCheckDefinition,
): RegisteredHealthCheck {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError('[narduk-core] registerHealthCheck expects a check definition object.')
  }
  const { name, required, run, timeoutMs = DEFAULT_HEALTH_CHECK_TIMEOUT_MS } = definition
  if (typeof name !== 'string' || !HEALTH_CHECK_NAME_PATTERN.test(name)) {
    throw new TypeError(
      `[narduk-core] Health check name ${JSON.stringify(name)} must be 1-63 lowercase letters, digits or hyphens.`,
    )
  }
  if (RESERVED_HEALTH_CHECK_NAMES.includes(name)) {
    throw new TypeError(
      `[narduk-core] Health check name '${name}' is reserved for a built-in probe.`,
    )
  }
  if (typeof required !== 'boolean') {
    throw new TypeError(
      `[narduk-core] Health check '${name}' must set required: true or required: false.`,
    )
  }
  if (typeof run !== 'function') {
    throw new TypeError(`[narduk-core] Health check '${name}' needs a run function.`)
  }
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_HEALTH_CHECK_TIMEOUT_MS
  ) {
    throw new TypeError(
      `[narduk-core] Health check '${name}' timeoutMs must be an integer from 1 to ${MAX_HEALTH_CHECK_TIMEOUT_MS}.`,
    )
  }
  return { name, required, run, timeoutMs }
}

/**
 * Keep a check's `detail` only when it is a plain JSON object without reserved
 * keys and within the size limit. The published value is the JSON round trip,
 * so the report carries exactly what was validated.
 */
export function sanitizeHealthCheckDetail(
  detail: unknown,
): Pick<HealthCheckReport, 'detail' | 'detailOmitted'> {
  if (detail === undefined) {
    return {}
  }
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { detailOmitted: 'not-an-object' }
  }

  let serialized: string
  try {
    serialized = JSON.stringify(detail)
  } catch {
    return { detailOmitted: 'not-serializable' }
  }

  if (RESERVED_DETAIL_KEY_PATTERN.test(serialized)) {
    return { detailOmitted: 'reserved-key' }
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_HEALTH_CHECK_DETAIL_BYTES) {
    return { detailOmitted: 'too-large' }
  }
  return { detail: JSON.parse(serialized) as HealthCheckDetail }
}

export type SettledWithTimeout<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' }

/**
 * Run `task` and settle within `timeoutMs`. On timeout the task's signal is
 * aborted and its eventual result is ignored.
 */
export async function settleWithTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => T | Promise<T>,
): Promise<SettledWithTimeout<T>> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<SettledWithTimeout<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${timeoutMs} ms.`))
      resolve({ kind: 'timeout' })
    }, timeoutMs)
  })
  const work = (async (): Promise<SettledWithTimeout<T>> => {
    try {
      return { kind: 'value', value: await task(controller.signal) }
    } catch (error) {
      return { kind: 'error', error }
    }
  })()

  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export interface HealthCheckFailureLogger {
  error: (message: string, data?: Record<string, unknown>) => void
}

/** Run one registered check and describe it for the public report. */
export async function runRegisteredHealthCheck(
  check: RegisteredHealthCheck,
  event: H3Event,
  log: HealthCheckFailureLogger,
): Promise<HealthCheckReport> {
  const startedAt = Date.now()
  const settled = await settleWithTimeout(check.timeoutMs, (signal) => check.run({ event, signal }))
  const base = {
    name: check.name,
    required: check.required,
  }
  const durationMs = Date.now() - startedAt

  if (settled.kind === 'timeout') {
    log.error('Health check timed out', { check: check.name, timeoutMs: check.timeoutMs })
    return {
      ...base,
      result: 'fail',
      durationMs,
      error: `Check timed out after ${check.timeoutMs} ms.`,
    }
  }
  if (settled.kind === 'error') {
    log.error('Health check failed', { check: check.name, error: String(settled.error) })
    return { ...base, result: 'fail', durationMs, error: 'Check failed.' }
  }

  const outcome = settled.value as HealthCheckOutcome | undefined
  const passed = outcome?.ok !== false
  if (!passed) {
    log.error('Health check reported a failure', { check: check.name })
  }
  return {
    ...base,
    result: passed ? 'pass' : 'fail',
    durationMs,
    ...sanitizeHealthCheckDetail(outcome?.detail),
  }
}
