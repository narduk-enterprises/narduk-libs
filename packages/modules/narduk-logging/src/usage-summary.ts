/**
 * One app's use, as a read-only summary another system can pull: screens and events by day, role
 * and platform (`./usage`), sign-ins by day and role (the app's own source), and errors by release
 * (`./client-errors`, `./server-health`). No person: no user, account, session, IP, message or
 * route of an error, only counts.
 *
 * The app mounts one route, `USAGE_SUMMARY_PATH`, behind a read-only bearer token of its own
 * (`authorizeUsageSummary`), and answers `buildUsageSummary`. A dashboard that watches many apps
 * (Narcode) pulls each with that app's token. A table the app does not have reads as empty.
 * Structural `D1Like`, no framework import.
 */
import { usageDay } from './usage.js'
import type { D1Like } from './server-health.js'

export type { D1Like, D1StatementLike } from './server-health.js'

export const USAGE_SUMMARY_SCHEMA_VERSION = 1
/** Where every app answers it: `GET`, `Authorization: Bearer <the app's summary token>`. */
export const USAGE_SUMMARY_PATH = '/api/usage/summary'
/** The widest range one request may ask for, and the range asked for when none is. */
export const USAGE_SUMMARY_MAX_DAYS = 90
export const USAGE_SUMMARY_DEFAULT_DAYS = 30
/** Rows per list; a longer list is cut, newest days first, and `truncated` says so. */
export const USAGE_SUMMARY_ROW_CAP = 20_000
/** A token shorter than this is refused as a setting, so a placeholder never opens the route. */
export const USAGE_SUMMARY_TOKEN_MIN = 32

export interface UsageSummaryCount {
  day: string
  name: string
  role: string
  platform: string
  count: number
}

export interface UsageSummarySignIns {
  day: string
  role: string
  count: number
}

export interface UsageSummaryErrors {
  /** `client`: browsers and native apps (`browser_errors`); `server`: 5xx (`server_errors`). */
  source: 'client' | 'server'
  /** The client's release; null for server errors, whose rows carry none. */
  release: string | null
  /** Distinct errors seen in the range. */
  errors: number
  /** Their occurrences, all time (a row keeps one running count). */
  occurrences: number
  lastSeenAt: string
}

export interface UsageSummary {
  schemaVersion: typeof USAGE_SUMMARY_SCHEMA_VERSION
  /** The app's own short name, e.g. `pacc-trac`. */
  app: string
  generatedAt: string
  /** First and last day, `YYYY-MM-DD`, both included, on the app's clock. */
  since: string
  until: string
  timeZone: string
  screens: UsageSummaryCount[]
  events: UsageSummaryCount[]
  signIns: UsageSummarySignIns[]
  errors: UsageSummaryErrors[]
  /** True when a list hit `USAGE_SUMMARY_ROW_CAP`: ask again for fewer days. */
  truncated: boolean
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function dayMinus(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(since: string, until: string): number {
  return (
    Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / 86_400_000) +
    1
  )
}

/** A real calendar day: `Date` rolls `2026-02-31` over to March, so the day must survive the round trip. */
const isDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DAY.test(value)) return false
  const at = Date.parse(`${value}T12:00:00Z`)
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value
}

/**
 * The first instant of `day` on the clock of `timeZone`, to the minute: the earliest moment whose
 * `usageDay` is `day`. Every zone's midnight lies within 15 hours of UTC's, so a search over that
 * window finds it, daylight saving included.
 */
export function usageDayStart(day: string, timeZone = 'UTC'): Date {
  if (!isDay(day)) throw new TypeError('usage day must be YYYY-MM-DD')
  const utc = Date.parse(`${day}T00:00:00Z`)
  let lo = utc - 15 * 3_600_000
  let hi = utc + 15 * 3_600_000
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000
    if (usageDay(new Date(mid), timeZone) >= day) hi = mid
    else lo = mid
  }
  return new Date(hi)
}

/**
 * The range a request asks for: `since` and `until` as `YYYY-MM-DD` (query strings), `until`
 * defaulting to `today` and `since` to 30 days before it. Null when a value is malformed, `since`
 * is after `until`, `until` is after `today`, or the range is wider than 90 days: the route answers
 * 400 rather than guess.
 */
export function parseUsageSummaryRange(
  query: { since?: unknown; until?: unknown },
  today: string,
): { since: string; until: string } | null {
  const until = query.until === undefined || query.until === '' ? today : query.until
  if (!isDay(until) || until > today) return null
  const since =
    query.since === undefined || query.since === ''
      ? dayMinus(until, USAGE_SUMMARY_DEFAULT_DAYS - 1)
      : query.since
  if (!isDay(since) || since > until) return null
  return daysBetween(since, until) <= USAGE_SUMMARY_MAX_DAYS ? { since, until } : null
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/**
 * Whether an `Authorization` header carries the app's summary token. Compared as SHA-256 digests in
 * constant time; false when the token is unset or shorter than `USAGE_SUMMARY_TOKEN_MIN`, so an app
 * that has not configured one answers no one.
 */
export async function authorizeUsageSummary(
  authorization: string | null | undefined,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || token.length < USAGE_SUMMARY_TOKEN_MIN) return false
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')
  if (!match?.[1]) return false
  const [a, b] = await Promise.all([sha256(match[1]), sha256(token)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

const missingTable = (error: unknown): boolean => /no such table/i.test(String(error))

/** A read of a table the app may not have: absent reads as no rows, anything else still throws. */
async function rowsOf<T>(read: () => Promise<{ results: T[] }>): Promise<T[]> {
  try {
    return (await read()).results
  } catch (error) {
    if (missingTable(error)) return []
    throw error
  }
}

/**
 * The summary for `since` through `until`. `signIns` is the app's own: sign-ins live in its audit,
 * not in this package, so it passes them in by day and role (or leaves them out). `timeZone` is the
 * clock the app counts days on (`usageDay`), stated in the answer.
 */
export async function buildUsageSummary(
  db: D1Like,
  options: {
    app: string
    since: string
    until: string
    timeZone?: string
    now?: Date
    signIns?: (range: { since: string; until: string }) => Promise<UsageSummarySignIns[]>
  },
): Promise<UsageSummary> {
  const { since, until } = options
  if (!isDay(since) || !isDay(until)) throw new TypeError('usage day must be YYYY-MM-DD')
  const now = options.now ?? new Date()
  const cap = USAGE_SUMMARY_ROW_CAP
  const counts = (kind: 'screen' | 'event') =>
    rowsOf(() =>
      db
        .prepare(
          `SELECT day, name, role, platform, count FROM usage_counts
           WHERE kind = ? AND day >= ? AND day <= ?
           ORDER BY day DESC, count DESC, name, role, platform LIMIT ?`,
        )
        .bind(kind, since, until, cap + 1)
        .all<UsageSummaryCount>(),
    )
  // An error row is in the range when it was last seen within it, on the app's clock.
  const timeZone = options.timeZone ?? 'UTC'
  const sinceAt = usageDayStart(since, timeZone).toISOString()
  const beforeAt = usageDayStart(dayMinus(until, -1), timeZone).toISOString()
  const [screens, events, clientErrors, serverErrors, signIns] = await Promise.all([
    counts('screen'),
    counts('event'),
    rowsOf(() =>
      db
        .prepare(
          `SELECT release, COUNT(*) AS errors, SUM(occurrences) AS occurrences, MAX(last_seen_at) AS last_seen_at
           FROM browser_errors WHERE last_seen_at >= ? AND last_seen_at < ?
           GROUP BY release ORDER BY 4 DESC LIMIT ?`,
        )
        .bind(sinceAt, beforeAt, cap)
        .all<{ release: string; errors: number; occurrences: number; last_seen_at: string }>(),
    ),
    rowsOf(() =>
      db
        .prepare(
          `SELECT COUNT(*) AS errors, SUM(occurrences) AS occurrences, MAX(last_seen_at) AS last_seen_at
           FROM server_errors WHERE last_seen_at >= ? AND last_seen_at < ?`,
        )
        .bind(sinceAt, beforeAt)
        .all<{ errors: number; occurrences: number | null; last_seen_at: string | null }>(),
    ),
    options.signIns ? options.signIns({ since, until }) : Promise.resolve([]),
  ])
  const count = (rows: UsageSummaryCount[]) =>
    rows.slice(0, cap).map((r) => ({
      day: r.day,
      name: r.name,
      role: r.role,
      platform: r.platform,
      count: Number(r.count),
    }))
  const errors: UsageSummaryErrors[] = clientErrors.map((r) => ({
    source: 'client',
    release: r.release,
    errors: Number(r.errors),
    occurrences: Number(r.occurrences),
    lastSeenAt: r.last_seen_at,
  }))
  for (const r of serverErrors) {
    if (Number(r.errors) > 0 && r.last_seen_at)
      errors.push({
        source: 'server',
        release: null,
        errors: Number(r.errors),
        occurrences: Number(r.occurrences ?? 0),
        lastSeenAt: r.last_seen_at,
      })
  }
  return {
    schemaVersion: USAGE_SUMMARY_SCHEMA_VERSION,
    app: options.app,
    generatedAt: now.toISOString(),
    since,
    until,
    timeZone,
    screens: count(screens),
    events: count(events),
    signIns: signIns
      .filter((s) => s.day >= since && s.day <= until)
      .map((s) => ({ day: s.day, role: s.role, count: Number(s.count) }))
      .slice(0, cap),
    errors,
    truncated: screens.length > cap || events.length > cap || signIns.length > cap,
  }
}

/**
 * Sign-ins by day and role from timestamps, on the app's clock: for an app whose audit holds one
 * row per sign-in (`at` an ISO instant, `role` already reduced to a label).
 */
export function signInsByDay(
  rows: ReadonlyArray<{ at: string; role: string }>,
  timeZone = 'UTC',
): UsageSummarySignIns[] {
  const sums = new Map<string, UsageSummarySignIns>()
  for (const row of rows) {
    const day = usageDay(new Date(row.at), timeZone)
    const key = `${day}\n${row.role}`
    const prior = sums.get(key)
    if (prior) prior.count += 1
    else sums.set(key, { day, role: row.role, count: 1 })
  }
  return [...sums.values()].sort(
    (a, b) => b.day.localeCompare(a.day) || a.role.localeCompare(b.role),
  )
}
