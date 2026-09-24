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
const HEALTH_CHECK_KIND_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u
// Uptime monitors match raw substrings such as `"status":"ok"` and
// `"database":"ok"` anywhere in the body, so check details may not carry
// either key: a nested value must never be able to mask the top-level result.
const RESERVED_DETAIL_KEY_PATTERN = /"(?:status|database)":/u

export type HealthCheckDetail = Record<string, unknown>

/**
 * How one failure rolls up, in the report's own vocabulary: `error` makes the
 * report `error` (HTTP 503), `degraded` makes it `degraded` (HTTP 200), and
 * `notice` leaves the report's `status` alone.
 *
 * `degraded` is not the mild option it reads as. A monitor that matches
 * `"status":"ok"` in the body -- the estate uptime detector does -- reads a
 * `degraded` report as down and pages exactly as it would for `error`. A
 * failure worth publishing but not worth a page is a `notice`: the entry still
 * says `result: 'fail'` with its `detail`, for a dashboard or a detector that
 * selects by `kind`, and the report stays `ok` (narduk-libs#414).
 */
export type HealthCheckSeverity = 'degraded' | 'error' | 'notice'

export interface HealthCheckContext {
  event: H3Event
  /** Aborted when the check exceeds its timeout; pass it to `fetch` and similar calls. */
  signal: AbortSignal
}

export interface HealthCheckOutcome {
  /**
   * A small JSON object published with the result, at most 1 KiB serialized.
   * Keys named `status` or `database`, at any depth, are rejected.
   */
  detail?: HealthCheckDetail
  /** `false` reports a failure without throwing. Omitted, the check passed. */
  ok?: boolean
  /**
   * How this particular failure should roll up, for a check that can fail at
   * more than one severity. It is published as the report entry's `required`
   * flag (`error` -> `true`, `degraded` -> `false`), plus `notice: true` for a
   * `notice`, which the rollup skips. A check declared `required: false` can
   * report `degraded` or `notice`; it cannot escalate itself into an HTTP 503.
   * Ignored when the check passed.
   */
  severity?: HealthCheckSeverity
}

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- lets a check be a plain `async () => {}` that passes by resolving
export type HealthCheckRunResult = HealthCheckOutcome | undefined | void

export interface HealthCheckDefinition {
  /**
   * A stable family label published verbatim on the report entry, so a
   * detector can select every check of one shape without knowing app-chosen
   * names. 1-32 lowercase letters, digits or hyphens. Core sets it for the
   * checks it builds (`freshness`); a plain `registerHealthCheck` leaves it
   * unset and the field is omitted.
   */
  kind?: string
  /** Lowercase letters, digits and hyphens; unique per app. */
  name: string
  /**
   * A required check that fails makes the whole report `error` (HTTP 503). An
   * optional check that fails makes it `degraded` (HTTP 200).
   */
  required: boolean
  /** Resolve (optionally with an outcome) to pass; throw or return `{ ok: false }` to fail. */
  run: (context: HealthCheckContext) => HealthCheckRunResult | Promise<HealthCheckRunResult>
  /** Defaults to 3000 ms; at most 30000 ms. A timed-out check fails. */
  timeoutMs?: number
}

export interface RegisteredHealthCheck extends HealthCheckDefinition {
  timeoutMs: number
}

export type HealthCheckResult = 'pass' | 'fail' | 'skipped'

export type HealthCheckDetailOmission =
  'not-an-object' | 'not-serializable' | 'reserved-key' | 'too-large'

/** One entry of `data.checks` in the `/api/health` response. */
export interface HealthCheckReport {
  detail?: HealthCheckDetail
  /** Why a check's `detail` was left out of the public report. */
  detailOmitted?: HealthCheckDetailOmission
  durationMs?: number
  /** Fixed public text for a failure; underlying errors go to the server log. */
  error?: string
  /** The check's family label, when it declared one. See `HealthCheckDefinition.kind`. */
  kind?: string
  name: string
  /**
   * `true` on a failure its check reported at `notice` severity: published for
   * observation, and left out of the report's `status`. Omitted otherwise.
   */
  notice?: true
  /** Why a check did not run. Present only when `result` is `skipped`. */
  reason?: string
  /**
   * Whether this entry makes the whole report `error` rather than `degraded`.
   * For a check with one failure mode it is the declared flag. For one that can
   * fail at more than one severity it is the severity of *this* failure; the
   * declared ceiling stays visible in `detail`.
   */
  required: boolean
  result: HealthCheckResult
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
  const { kind, name, required, run, timeoutMs = DEFAULT_HEALTH_CHECK_TIMEOUT_MS } = definition
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
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_HEALTH_CHECK_TIMEOUT_MS) {
    throw new TypeError(
      `[narduk-core] Health check '${name}' timeoutMs must be an integer from 1 to ${MAX_HEALTH_CHECK_TIMEOUT_MS}.`,
    )
  }
  if (kind !== undefined && (typeof kind !== 'string' || !HEALTH_CHECK_KIND_PATTERN.test(kind))) {
    throw new TypeError(
      `[narduk-core] Health check '${name}' kind ${JSON.stringify(kind)} must be 1-32 lowercase letters, digits or hyphens.`,
    )
  }
  return kind === undefined
    ? { name, required, run, timeoutMs }
    : { kind, name, required, run, timeoutMs }
}

/**
 * Resolve the `required` flag one failure publishes. A check may lower its own
 * severity for a single failure, never raise it above what it declared, so an
 * optional check can never turn the report into an HTTP 503.
 */
export function resolveFailureRequired(declaredRequired: boolean, severity: unknown): boolean {
  // An optional check stays optional, and an unrecognized value falls back to
  // the declaration rather than silently downgrading a required failure.
  if (!declaredRequired) {
    return false
  }
  return severity === 'degraded' || severity === 'notice' ? false : true
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
  { kind: 'value'; value: T } | { error: unknown; kind: 'error' } | { kind: 'timeout' }

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
    ...(check.kind === undefined ? {} : { kind: check.kind }),
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
  const notice = !passed && outcome?.severity === 'notice'
  if (!passed && !notice) {
    log.error('Health check reported a failure', { check: check.name })
  }
  return {
    ...base,
    ...(notice ? { notice: true as const } : {}),
    // A timed-out or thrown check keeps the declared flag: only a check that
    // reported its own failure may say this one was the milder kind.
    required: passed ? check.required : resolveFailureRequired(check.required, outcome?.severity),
    result: passed ? 'pass' : 'fail',
    durationMs,
    ...sanitizeHealthCheckDetail(outcome?.detail),
  }
}
