/**
 * Durable client-error capture for Cloudflare D1 apps: unhandled errors a browser (or a native
 * app) reports, one row per error, beside `./server-health`'s server errors.
 *
 * A report carries four fields and nothing else: a message, the path, the release, and a request
 * id. No stack, no query string, no form contents, no cookie. The server collapses the path to a
 * route, scrubs emails and opaque runs from the message, dedupes by hash and keeps the newest 200.
 * The app owns its migration (`BROWSER_ERRORS_DDL`) and its route: same-origin, rate-limited,
 * `parseClientErrorReport`, the `createErrorThrottle` from `./server-health`, then
 * `recordClientError`. Structural `D1Like`, no framework import.
 */
import { collapseRoute, scrubErrorMessage, serverErrorHash } from './server-health.js'
import type { D1Like } from './server-health.js'

export type { D1Like, D1StatementLike } from './server-health.js'

export const BROWSER_ERRORS_DDL = `CREATE TABLE browser_errors (
  error_hash TEXT PRIMARY KEY NOT NULL,
  service TEXT NOT NULL,
  route TEXT NOT NULL,
  message TEXT NOT NULL,
  release TEXT NOT NULL,
  request_id TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_browser_errors_last_seen ON browser_errors(last_seen_at DESC);`

/** What a client may tell the server about an unhandled error. */
export const CLIENT_ERROR_LIMITS = {
  messageMax: 200,
  pathMax: 120,
  releaseMax: 40,
  bodyMaxBytes: 2048,
  /** Reports one page load (or app launch) sends at most. */
  perPageLoad: 5,
} as const

export const REQUEST_ID_SHAPE = /^[\w.:-]{1,128}$/

export interface ClientErrorReport {
  message: string
  path: string
  release: string
  requestId: string | null
}

export const DEFAULT_CLIENT_ERROR_ROW_CAP = 200

export interface ClientErrorEntry {
  errorHash: string
  service: string
  route: string
  message: string
  release: string
  requestId: string | null
  /** Occurrences this write stands for. */
  count: number
  at: string
}

export interface ClientErrorRow {
  errorHash: string
  service: string
  route: string
  message: string
  release: string
  requestId: string | null
  occurrences: number
  firstSeenAt: string
  lastSeenAt: string
}

const L = CLIENT_ERROR_LIMITS
const KEYS = ['message', 'path', 'release', 'requestId']

/**
 * A report a client sent, or null. Strict: exactly the four keys, each within its limit, the
 * request id null or `REQUEST_ID_SHAPE`. Anything extra (a stack, form values) refuses the whole
 * report rather than being dropped, so a client that sends more is found, not quietly trusted.
 */
export function parseClientErrorReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const keys = Object.keys(body)
  if (keys.length !== KEYS.length || !keys.every((key) => KEYS.includes(key))) return null
  const { message, path, release, requestId } = body as Record<string, unknown>
  if (typeof message !== 'string' || message.length < 1 || message.length > L.messageMax)
    return null
  if (typeof path !== 'string' || path.length > L.pathMax) return null
  if (typeof release !== 'string' || release.length > L.releaseMax) return null
  if (requestId !== null && (typeof requestId !== 'string' || !REQUEST_ID_SHAPE.test(requestId)))
    return null
  return { message, path, release, requestId }
}

/** A report as a row: route collapsed, message scrubbed of emails and opaque runs, hash stable per message and route. */
export function clientErrorEntry(
  report: ClientErrorReport,
  service: string,
  at: string,
  count = 1,
): ClientErrorEntry {
  const route = collapseRoute(report.path)
  const message = scrubErrorMessage(report.message)
  return {
    errorHash: serverErrorHash({ status: 0, name: `browser:${route}`, message }),
    service,
    route,
    message,
    release: report.release,
    requestId: report.requestId,
    count,
    at,
  }
}

/** Upserts by error hash, then prunes to the newest `rowCap` rows. */
export async function recordClientError(
  db: D1Like,
  entry: ClientErrorEntry,
  options: { rowCap?: number } = {},
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO browser_errors (error_hash, service, route, message, release, request_id, occurrences, first_seen_at, last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(error_hash) DO UPDATE SET occurrences = occurrences + excluded.occurrences,
           first_seen_at = MIN(first_seen_at, excluded.first_seen_at), last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
           release = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.release ELSE release END,
           request_id = CASE WHEN excluded.last_seen_at >= last_seen_at THEN COALESCE(excluded.request_id, request_id) ELSE request_id END`,
      )
      .bind(
        entry.errorHash,
        entry.service,
        entry.route,
        entry.message,
        entry.release,
        entry.requestId,
        entry.count,
        entry.at,
        entry.at,
      ),
    db
      .prepare(
        `DELETE FROM browser_errors WHERE error_hash NOT IN
         (SELECT error_hash FROM browser_errors ORDER BY last_seen_at DESC, error_hash LIMIT ?)`,
      )
      .bind(options.rowCap ?? DEFAULT_CLIENT_ERROR_ROW_CAP),
  ])
}

export async function listClientErrors(db: D1Like, limit = 100): Promise<ClientErrorRow[]> {
  const { results } = await db
    .prepare(
      `SELECT error_hash, service, route, message, release, request_id, occurrences, first_seen_at, last_seen_at
       FROM browser_errors ORDER BY last_seen_at DESC, error_hash LIMIT ?`,
    )
    .bind(Math.min(Math.max(1, limit), DEFAULT_CLIENT_ERROR_ROW_CAP))
    .all<Record<string, string | number | null>>()
  return results.map((r) => ({
    errorHash: r.error_hash as string,
    service: r.service as string,
    route: r.route as string,
    message: r.message as string,
    release: r.release as string,
    requestId: r.request_id as string | null,
    occurrences: r.occurrences as number,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
  }))
}

// ---- client ----------------------------------------------------------------------------------

interface ReasonLike {
  name?: unknown
  message?: unknown
  data?: { requestId?: unknown } | null
  response?: { headers?: { get?: (name: string) => string | null } }
}

function requestIdOf(reason: ReasonLike): string | null {
  const id = reason.data?.requestId ?? reason.response?.headers?.get?.('x-request-id')
  return typeof id === 'string' && REQUEST_ID_SHAPE.test(id) ? id : null
}

/**
 * The message and request id of a thrown value, or null for an `AbortError`. Anything that is not
 * an Error or a string reports as a fixed phrase and no request id, never its contents.
 */
export function describeClientError(
  reason: unknown,
): { message: string; requestId: string | null } | null {
  const like = (reason && typeof reason === 'object' ? reason : {}) as ReasonLike
  if (like.name === 'AbortError') return null
  const text =
    reason instanceof Error
      ? reason.message || reason.name
      : typeof reason === 'string'
        ? reason
        : 'Non-error value thrown'
  // Only an Error's request id (a fetch error carries one): a plain object's fields are never read.
  return {
    message: text.trim().slice(0, L.messageMax) || 'Error',
    requestId: reason instanceof Error ? requestIdOf(like) : null,
  }
}

/**
 * One reporter per page load: drops repeats of the same message on the same path, stops after
 * `perPageLoad` reports, and never sends a report over `bodyMaxBytes`.
 */
export function createClientErrorReporter(options: {
  send: (report: ClientErrorReport) => void
  release: string
  path: () => string
}): (reason: unknown) => void {
  const seen = new Set<string>()
  return (reason) => {
    if (seen.size >= L.perPageLoad) return
    const described = describeClientError(reason)
    if (!described) return
    const path = (options.path().split(/[?#]/)[0] ?? '').slice(0, L.pathMax)
    const key = `${described.message}\n${path}`
    if (seen.has(key)) return
    seen.add(key)
    const report: ClientErrorReport = {
      message: described.message,
      path,
      release: options.release.slice(0, L.releaseMax),
      requestId: described.requestId,
    }
    if (new TextEncoder().encode(JSON.stringify(report)).length > L.bodyMaxBytes) return
    options.send(report)
  }
}
