/**
 * Durable server-error capture and cron heartbeat for Cloudflare D1 apps.
 *
 * The app owns its migrations: copy `SERVER_ERRORS_DDL` and `JOB_RUNS_DDL` into a new expand-only
 * migration. Everything here is structural (`D1Like`, `NitroErrorHost`), so it imports neither
 * `@cloudflare/workers-types`, `h3` nor `nitropack`. Capture is best effort and never throws into
 * the request that failed.
 */

export const SERVER_ERRORS_DDL = `CREATE TABLE server_errors (
  stack_hash TEXT PRIMARY KEY NOT NULL,
  service TEXT NOT NULL,
  status INTEGER NOT NULL CHECK (status BETWEEN 500 AND 599),
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  message TEXT NOT NULL,
  request_id TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_server_errors_last_seen ON server_errors(last_seen_at DESC);`

export const JOB_RUNS_DDL = `CREATE TABLE job_runs (
  job TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER CHECK (ok IN (0, 1)),
  error TEXT,
  last_ok_at TEXT
);`

// ---- structural D1 ---------------------------------------------------------------------------

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  run(): Promise<unknown>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
}

/** The slice of a D1 database this module uses; a real `D1Database` satisfies it. */
export interface D1Like {
  prepare(sql: string): D1StatementLike
  batch(statements: D1StatementLike[]): Promise<unknown>
}

// ---- pure rules ------------------------------------------------------------------------------

const MESSAGE_MAX = 200
const ROUTE_MAX = 120
const STACK_FRAMES = 3

/** A path with the query dropped and opaque segments (ids, tokens) collapsed, so a capability link never lands in a row. */
export function collapseRoute(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? ''
  const segments = bare.split('/').map((segment) => {
    if (!segment) return segment
    const opaque = (/\d/.test(segment) && segment.length >= 8) || /^[\w-]{20,}$/.test(segment)
    return opaque ? ':id' : segment
  })
  return (segments.join('/') || '/').slice(0, ROUTE_MAX)
}

/** An error message safe to keep: emails and long opaque runs removed, whitespace collapsed, length capped. */
export function scrubErrorMessage(message: string): string {
  // Capped input and bounded quantifiers keep every pattern linear on hostile text (CodeQL js/polynomial-redos).
  return message
    .slice(0, MESSAGE_MAX * 8)
    .replaceAll(/[^\s@]{1,64}@[^\s@.]{1,253}(?:\.[^\s@.]{1,63})+/g, '[email]')
    .replaceAll(/[\w-]{24,}/g, '…')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
}

function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function frameKey(line: string): string {
  const open = line.indexOf('(')
  const fn = open > 0 ? line.slice(3, open).trim() : ''
  const where = open > 0 ? line.slice(open + 1).replace(/\)$/, '') : line.slice(3)
  const match = /([^/\s?]+)(?:\?[^:\s]*)?:(\d+)(?::\d+)?$/.exec(where)
  return `${fn}(${match ? `${match[1]}:${match[2]}` : where.slice(-40)})`
}

/** The top frames as function and file:line, with origins, columns and query strings dropped: stable across builds of one code path, distinct per call site. */
function topFrames(stack: string | undefined): string {
  return (stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, STACK_FRAMES)
    .map((line) => frameKey(line))
    .join('|')
}

/** Identity of an error for deduplication: status, name, the message with ids and digits flattened, and the top frames. */
export function serverErrorHash(input: {
  status: number
  name: string
  message: string
  stack?: string
}): string {
  const flat = scrubErrorMessage(input.message).replaceAll(/\d+/g, '#')
  const key = `${input.status}\n${input.name}\n${flat}\n${topFrames(input.stack)}`
  return fnv1a(key, 0x811c9dc5) + fnv1a(key, 0x01000193 ^ 0x9e3779b9)
}

export type JobState = 'ok' | 'stale' | 'never_run'

/** Stale once the last success is MORE than twice the interval old; exactly twice is still ok. No success yet is its own state. */
export function jobState(lastOkAt: string | null, intervalMinutes: number, now: Date): JobState {
  if (!lastOkAt) return 'never_run'
  const last = Date.parse(lastOkAt)
  if (Number.isNaN(last)) return 'stale'
  return now.getTime() - last > 2 * intervalMinutes * 60_000 ? 'stale' : 'ok'
}

export interface JobReport<Name extends string = string> {
  job: Name
  intervalMinutes: number
  lastOkAt: string | null
  state: JobState
}

/** One report per registered job, in registry order; a job with no heartbeat row yet reads `never_run`. */
export function jobReports<Name extends string>(
  registry: Readonly<Record<Name, { intervalMinutes: number }>>,
  lastOkByJob: ReadonlyMap<string, string | null>,
  now: Date,
): Array<JobReport<Name>> {
  return (Object.keys(registry) as Name[]).map((job) => {
    const { intervalMinutes } = registry[job]
    const lastOkAt = lastOkByJob.get(job) ?? null
    return { job, intervalMinutes, lastOkAt, state: jobState(lastOkAt, intervalMinutes, now) }
  })
}

// ---- throttle --------------------------------------------------------------------------------

export interface ErrorThrottleOptions {
  now?: () => number
  /** One write per hash per window. Default 60 000 ms. */
  windowMs?: number
  /** Writes per window across all hashes. Default 20. */
  maxWritesPerWindow?: number
}

const SEEN_MAX = 500

/**
 * Per-isolate throttle. Returns the occurrence count a write should carry (1 plus any repeats it
 * suppressed since the last write of that hash), or null when this occurrence must not be written.
 */
export function createErrorThrottle(options: ErrorThrottleOptions = {}) {
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? 60_000
  const maxWrites = options.maxWritesPerWindow ?? 20
  const lastWrite = new Map<string, number>()
  const suppressed = new Map<string, number>()
  let windowStart = 0
  let windowWrites = 0
  return (hash: string): number | null => {
    const t = now()
    if (t - windowStart >= windowMs) {
      windowStart = t
      windowWrites = 0
    }
    const last = lastWrite.get(hash)
    const owed = suppressed.get(hash) ?? 0
    if ((last !== undefined && t - last < windowMs) || windowWrites >= maxWrites) {
      if (suppressed.size < SEEN_MAX || suppressed.has(hash)) suppressed.set(hash, owed + 1)
      return null
    }
    if (lastWrite.size >= SEEN_MAX) lastWrite.clear()
    lastWrite.set(hash, t)
    suppressed.delete(hash)
    windowWrites++
    return owed + 1
  }
}

// ---- storage ---------------------------------------------------------------------------------

export const DEFAULT_SERVER_ERROR_ROW_CAP = 200

export interface ServerErrorEntry {
  stackHash: string
  service: string
  status: number
  method: string
  route: string
  message: string
  requestId: string | null
  /** Occurrences this write stands for. */
  count: number
  at: string
}

export interface ServerErrorRow {
  stackHash: string
  service: string
  status: number
  method: string
  route: string
  message: string
  requestId: string | null
  occurrences: number
  firstSeenAt: string
  lastSeenAt: string
}

/** Upserts by stack hash, then prunes to the newest `rowCap` rows, so a storm of distinct errors cannot grow the table. */
export async function recordServerError(
  db: D1Like,
  entry: ServerErrorEntry,
  options: { rowCap?: number } = {},
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO server_errors (stack_hash, service, status, method, route, message, request_id, occurrences, first_seen_at, last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(stack_hash) DO UPDATE SET occurrences = occurrences + excluded.occurrences,
           last_seen_at = excluded.last_seen_at, request_id = excluded.request_id`,
      )
      .bind(
        entry.stackHash,
        entry.service,
        entry.status,
        entry.method,
        entry.route,
        entry.message,
        entry.requestId,
        entry.count,
        entry.at,
        entry.at,
      ),
    db
      .prepare(
        `DELETE FROM server_errors WHERE stack_hash NOT IN
         (SELECT stack_hash FROM server_errors ORDER BY last_seen_at DESC, stack_hash LIMIT ?)`,
      )
      .bind(options.rowCap ?? DEFAULT_SERVER_ERROR_ROW_CAP),
  ])
}

export async function listServerErrors(db: D1Like, limit = 100): Promise<ServerErrorRow[]> {
  const { results } = await db
    .prepare(
      `SELECT stack_hash, service, status, method, route, message, request_id, occurrences, first_seen_at, last_seen_at
       FROM server_errors ORDER BY last_seen_at DESC, stack_hash LIMIT ?`,
    )
    .bind(Math.min(Math.max(1, limit), DEFAULT_SERVER_ERROR_ROW_CAP))
    .all<Record<string, string | number | null>>()
  return results.map((r) => ({
    stackHash: r.stack_hash as string,
    service: r.service as string,
    status: r.status as number,
    method: r.method as string,
    route: r.route as string,
    message: r.message as string,
    requestId: r.request_id as string | null,
    occurrences: r.occurrences as number,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
  }))
}

// ---- heartbeat -------------------------------------------------------------------------------

export interface JobRunRow {
  job: string
  startedAt: string
  finishedAt: string | null
  ok: boolean | null
  error: string | null
  lastOkAt: string | null
}

const JOB_ERROR_MAX = 200

/** Written before the run, so a run the runtime kills reads as started but never finished. Keeps the last success. */
export async function beginJobRun(db: D1Like, job: string, at: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO job_runs (job, started_at) VALUES (?, ?)
       ON CONFLICT(job) DO UPDATE SET started_at = excluded.started_at, finished_at = NULL, ok = NULL, error = NULL`,
    )
    .bind(job, at)
    .run()
}

export async function finishJobRun(
  db: D1Like,
  job: string,
  at: string,
  outcome: { ok: boolean; error?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE job_runs SET finished_at = ?, ok = ?, error = ?, last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END WHERE job = ?`,
    )
    .bind(
      at,
      outcome.ok ? 1 : 0,
      outcome.ok ? null : scrubErrorMessage(outcome.error ?? 'failed').slice(0, JOB_ERROR_MAX),
      outcome.ok ? 1 : 0,
      at,
      job,
    )
    .run()
}

export async function listJobRuns(db: D1Like): Promise<JobRunRow[]> {
  const { results } = await db
    .prepare(
      'SELECT job, started_at, finished_at, ok, error, last_ok_at FROM job_runs ORDER BY job',
    )
    .all<{
      job: string
      started_at: string
      finished_at: string | null
      ok: number | null
      error: string | null
      last_ok_at: string | null
    }>()
  return results.map((r) => ({
    job: r.job,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    ok: r.ok === null ? null : r.ok === 1,
    error: r.error,
    lastOkAt: r.last_ok_at,
  }))
}

/**
 * Runs a scheduled job and records its heartbeat. `run` resolves to the names of steps that failed
 * but were swallowed (an empty list is a clean run); a throw is recorded and rethrown. A failed
 * heartbeat write never changes the job's outcome.
 */
export async function runWithHeartbeat(
  db: D1Like,
  job: string,
  run: () => Promise<readonly string[]>,
  options: { now?: () => Date; onWriteError?: (what: string, error: unknown) => void } = {},
): Promise<void> {
  const now = options.now ?? (() => new Date())
  const report =
    options.onWriteError ??
    ((what, error) =>
      console.error(
        `heartbeat ${what} failed for ${job}`,
        error instanceof Error ? error.message : error,
      ))
  try {
    await beginJobRun(db, job, now().toISOString())
  } catch (error) {
    report('start', error)
  }
  let outcome: { ok: boolean; error?: string }
  try {
    const failedSteps = await run()
    outcome = failedSteps.length
      ? { ok: false, error: `failed: ${failedSteps.join(', ')}` }
      : { ok: true }
  } catch (error) {
    try {
      await finishJobRun(db, job, now().toISOString(), {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    } catch {
      // the job's own error is the one to surface
    }
    throw error
  }
  try {
    await finishJobRun(db, job, now().toISOString(), outcome)
  } catch (error) {
    report('finish', error)
  }
}

// ---- Nitro error hook ------------------------------------------------------------------------

/** The request fields capture reads off an H3 event, as duck-typed by h3 1.x. */
export interface ErrorEventLike {
  method?: string
  path?: string
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } }
}

export interface NitroErrorHost<Event = ErrorEventLike> {
  hooks: {
    hook(
      name: 'error',
      handler: (error: unknown, context: { event?: Event }) => Promise<void> | void,
    ): unknown
  }
}

export interface ServerErrorCandidate {
  stackHash: string
  service: string
  status: number
  method: string
  route: string
  message: string
  requestId: string | null
}

function statusOf(error: unknown): number {
  const e = error as { statusCode?: unknown; status?: unknown } | null
  const status = Number(e?.statusCode ?? e?.status ?? 500)
  return Number.isFinite(status) ? status : 500
}

/** What a request error becomes as a row, or null when it is not a 5xx. */
export function serverErrorCandidate(
  error: unknown,
  request: { method: string; path: string; requestId: string | null },
  service: string,
): ServerErrorCandidate | null {
  const status = statusOf(error)
  if (status < 500 || status > 599) return null
  const source = ((error as { cause?: unknown } | null)?.cause ?? error) as {
    name?: string
    message?: string
    stack?: string
  } | null
  const name = source?.name ?? 'Error'
  const raw = source?.message || (error as { message?: string } | null)?.message || 'Server error'
  return {
    stackHash: serverErrorHash({ status, name, message: raw, stack: source?.stack }),
    service,
    status,
    method: request.method.toUpperCase().slice(0, 10),
    route: collapseRoute(request.path),
    message: scrubErrorMessage(`${name}: ${raw}`),
    requestId: request.requestId,
  }
}

export interface ServerErrorCaptureOptions<Event = ErrorEventLike> {
  /** Which Worker/plane wrote the row, stored in `service`. */
  service: string
  /** The D1 binding for this request, or undefined when there is none (the error is then skipped). */
  resolveDb: (event: Event) => D1Like | undefined
  /** Replaces the default `recordServerError` write. */
  write?: (db: D1Like, entry: ServerErrorEntry) => Promise<void>
  rowCap?: number
  throttle?: ErrorThrottleOptions
  onFailure?: (error: unknown) => void
}

function headerOf(event: ErrorEventLike, name: string): string | null {
  const value = event.node?.req?.headers?.[name]
  const text = Array.isArray(value) ? value[0] : value
  return text && /^[\w.:-]{1,128}$/.test(text) ? text : null
}

/**
 * Registers a Nitro `error` hook that records unhandled 5xx errors. Writes are bounded three ways:
 * one row per stack hash, a per-isolate throttle (suppressed repeats fold into the next write's
 * count), and the newest-N prune. The hook never throws and skips errors with no request or no DB.
 */
export function installServerErrorCapture<Event extends ErrorEventLike = ErrorEventLike>(
  host: NitroErrorHost<Event>,
  options: ServerErrorCaptureOptions<Event>,
): void {
  const admit = createErrorThrottle(options.throttle)
  const write =
    options.write ?? ((db, entry) => recordServerError(db, entry, { rowCap: options.rowCap }))
  const fail =
    options.onFailure ??
    ((error) =>
      console.error('server error capture failed', error instanceof Error ? error.message : error))
  host.hooks.hook('error', async (error, context) => {
    try {
      const event = context?.event
      if (!event) return
      const db = options.resolveDb(event)
      if (!db) return
      const candidate = serverErrorCandidate(
        error,
        {
          method: event.method ?? 'GET',
          path: event.path ?? '/',
          requestId: headerOf(event, 'cf-ray') ?? headerOf(event, 'x-request-id'),
        },
        options.service,
      )
      if (!candidate) return
      const count = admit(candidate.stackHash)
      if (count === null) return
      await write(db, {
        ...candidate,
        count,
        at: new Date((options.throttle?.now ?? Date.now)()).toISOString(),
      })
    } catch (error_) {
      fail(error_)
    }
  })
}
