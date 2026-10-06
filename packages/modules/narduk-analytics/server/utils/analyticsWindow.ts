/**
 * One normalized query window for every admin analytics read: a preset
 * (`1h`..`72h`, `1d`..`180d`) or a custom `[start, end)` pair of local dates,
 * in a display time zone, plus the traffic classes to count.
 *
 * Pure and clock-injected so the HogQL a route builds from it is testable
 * without PostHog. Boundaries are UTC instants; day buckets are calendar days
 * in the display zone (never re-cut from UTC), hourly and finer buckets are
 * aligned to the epoch.
 */
import { z } from 'zod'

export const ANALYTICS_MAX_DAYS = 180
export const ANALYTICS_MAX_HOURS = 72

export type AnalyticsBucket = '1d' | '1h' | '5m' | '15m'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const BUCKET_MS: Record<AnalyticsBucket, number> = {
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '1h': HOUR,
  '1d': DAY,
}

/** A bad window or time zone: the route answers 400 with this message. */
export class AnalyticsWindowError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsWindowError'
  }
}

export interface AnalyticsSlot {
  endMs: number
  /** Day buckets: the local `YYYY-MM-DD`; finer buckets: epoch seconds. */
  key: string
  startMs: number
}

export interface AnalyticsWindow {
  bucket: AnalyticsBucket
  bucketMs: number
  custom: boolean
  /** Last local day the window covers (inclusive), for the daily-only Google reads. */
  endDate: string
  fromIso: string
  fromMs: number
  /** Cache key: identical windows share it. */
  key: string
  /** `7d`, `1h`, or `YYYY-MM-DD..YYYY-MM-DD` for a custom window. */
  label: string
  slots: AnalyticsSlot[]
  startDate: string
  toIso: string
  toMs: number
  tz: string
}

// ── time zones ───────────────────────────────────────────────────────────

const ZONE_SHAPE = /^[\w+\-/]{1,64}$/u

/** Throws unless `tz` is an IANA zone this runtime knows. Defaults to UTC. */
export function assertAnalyticsTimeZone(tz: string | undefined): string {
  const zone = (tz ?? 'UTC').trim() || 'UTC'
  if (zone === 'UTC') return zone
  if (!ZONE_SHAPE.test(zone)) throw new AnalyticsWindowError('Unknown time zone.')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)
  } catch {
    throw new AnalyticsWindowError('Unknown time zone.')
  }
  return zone
}

interface ZoneParts {
  day: number
  hour: number
  minute: number
  month: number
  second: number
  year: number
}

function zoneParts(ms: number, tz: string): ZoneParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function zoneOffsetMs(ms: number, tz: string): number {
  const p = zoneParts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`

/** The local `YYYY-MM-DD` of an instant. */
export function analyticsLocalDateKey(ms: number, tz: string): string {
  const p = zoneParts(ms, tz)
  return dateKey(p.year, p.month, p.day)
}

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/u

function parseDateKey(value: string): { day: number; month: number; year: number } | null {
  const match = DATE_SHAPE.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

/** Calendar arithmetic on a `YYYY-MM-DD` key (no zone involved). */
export function analyticsAddDays(key: string, days: number): string {
  const parsed = parseDateKey(key)
  if (!parsed) throw new AnalyticsWindowError('Dates are YYYY-MM-DD.')
  const moved = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days))
  return dateKey(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate())
}

/** The UTC instant of local midnight on `key` in `tz` (DST-safe). */
export function analyticsLocalMidnightMs(key: string, tz: string): number {
  const parsed = parseDateKey(key)
  if (!parsed) throw new AnalyticsWindowError('Dates are YYYY-MM-DD.')
  const wall = Date.UTC(parsed.year, parsed.month - 1, parsed.day)
  let guess = wall - zoneOffsetMs(wall, tz)
  guess = wall - zoneOffsetMs(guess, tz)
  return guess
}

// ── window ───────────────────────────────────────────────────────────────

const PERIOD_SHAPE = /^(\d{1,3})([dh])$/u

function hourlyBucket(hours: number): AnalyticsBucket {
  if (hours <= 1) return '5m'
  if (hours <= 3) return '15m'
  return '1h'
}

function daySlots(startKey: string, count: number, tz: string): AnalyticsSlot[] {
  const slots: AnalyticsSlot[] = []
  for (let i = 0; i < count; i += 1) {
    const key = analyticsAddDays(startKey, i)
    slots.push({
      key,
      startMs: analyticsLocalMidnightMs(key, tz),
      endMs: analyticsLocalMidnightMs(analyticsAddDays(key, 1), tz),
    })
  }
  return slots
}

function finish(
  slots: AnalyticsSlot[],
  bucket: AnalyticsBucket,
  tz: string,
  label: string,
  custom: boolean,
): AnalyticsWindow {
  const first = slots[0]!
  const last = slots.at(-1)!
  const day = bucket === '1d'
  const startDate = day ? first.key : analyticsLocalDateKey(first.startMs, tz)
  const endDate = day ? last.key : analyticsLocalDateKey(last.endMs - 1, tz)
  return {
    bucket,
    bucketMs: BUCKET_MS[bucket],
    custom,
    startDate,
    endDate,
    fromMs: first.startMs,
    toMs: last.endMs,
    fromIso: new Date(first.startMs).toISOString(),
    toIso: new Date(last.endMs).toISOString(),
    key: `${tz}|${first.startMs}|${last.endMs}|${bucket}`,
    label,
    slots,
    tz,
  }
}

export interface AnalyticsWindowInput {
  /** Custom end, a local `YYYY-MM-DD`, excluded. */
  end?: string
  /** `Nh` or `Nd`. */
  period?: string
  /** Custom start, a local `YYYY-MM-DD`, included. */
  start?: string
  tz?: string
}

export function resolveAnalyticsWindow(
  input: AnalyticsWindowInput,
  nowMs: number = Date.now(),
  defaultPeriod = '30d',
): AnalyticsWindow {
  const tz = assertAnalyticsTimeZone(input.tz)
  const todayKey = analyticsLocalDateKey(nowMs, tz)

  if (input.start !== undefined || input.end !== undefined) {
    if (!input.start || !input.end) {
      throw new AnalyticsWindowError('A custom range needs a start and an end date.')
    }
    if (!parseDateKey(input.start) || !parseDateKey(input.end)) {
      throw new AnalyticsWindowError('Dates are YYYY-MM-DD.')
    }
    if (input.end <= input.start) {
      throw new AnalyticsWindowError('End must be after start. The end day is excluded.')
    }
    const startMs = analyticsLocalMidnightMs(input.start, tz)
    const endMs = analyticsLocalMidnightMs(input.end, tz)
    const days = Math.round((endMs - startMs) / DAY)
    if (days > ANALYTICS_MAX_DAYS) {
      throw new AnalyticsWindowError(`Up to ${ANALYTICS_MAX_DAYS} days.`)
    }
    if (input.end > analyticsAddDays(todayKey, 1)) {
      throw new AnalyticsWindowError('End can’t be after tomorrow.')
    }
    return finish(
      daySlots(input.start, Math.max(1, days), tz),
      '1d',
      tz,
      `${input.start}..${input.end}`,
      true,
    )
  }

  const period = (input.period ?? defaultPeriod).trim().toLowerCase()
  const match = PERIOD_SHAPE.exec(period)
  const value = Number(match?.[1] ?? 0)
  if (!match || value < 1) throw new AnalyticsWindowError('Period is Nh or Nd, for example 24h.')

  if (match[2] === 'd') {
    if (value > ANALYTICS_MAX_DAYS) {
      throw new AnalyticsWindowError(`Up to ${ANALYTICS_MAX_DAYS} days.`)
    }
    return finish(
      daySlots(analyticsAddDays(todayKey, -(value - 1)), value, tz),
      '1d',
      tz,
      period,
      false,
    )
  }

  if (value > ANALYTICS_MAX_HOURS) {
    throw new AnalyticsWindowError(`Hourly ranges go up to ${ANALYTICS_MAX_HOURS} h; use days.`)
  }
  const bucket = hourlyBucket(value)
  const size = BUCKET_MS[bucket]
  const end = Math.floor(nowMs / size) * size + size
  const count = Math.round((value * HOUR) / size)
  const slots: AnalyticsSlot[] = []
  for (let i = 0; i < count; i += 1) {
    const startMs = end - (count - i) * size
    slots.push({ key: String(startMs / 1000), startMs, endMs: startMs + size })
  }
  return finish(slots, bucket, tz, period, false)
}

// ── traffic ──────────────────────────────────────────────────────────────

/** The classes the module stamps on events. `external` is accepted as an alias of `unmarked`. */
export const ANALYTICS_TRAFFIC_CLASSES = ['unmarked', 'owner', 'automation'] as const
const ACCEPTED_CLASSES = new Set<string>([...ANALYTICS_TRAFFIC_CLASSES, 'external', 'preview'])

export interface AnalyticsTraffic {
  /** Classes to count, or `null` for all of them. */
  classes: string[] | null
  /** `external`, `all`, or the sorted comma list. */
  key: string
}

/**
 * `external` (the default) counts events whose `traffic_class` is missing or
 * unmarked. `all` counts everything. A comma list counts exactly those classes.
 */
export function resolveAnalyticsTraffic(value: string | undefined): AnalyticsTraffic {
  const raw = (value ?? 'external').trim().toLowerCase()
  if (raw === 'all') return { key: 'all', classes: null }
  if (raw === 'external' || raw === '') return { key: 'external', classes: ['unmarked'] }
  const classes = [...new Set(raw.split(',').map((item) => item.trim()))].sort()
  if (classes.length === 0 || classes.some((item) => !ACCEPTED_CLASSES.has(item))) {
    throw new AnalyticsWindowError('Traffic is external, all, or a list of traffic classes.')
  }
  return { key: classes.join(','), classes }
}

export const analyticsWindowQuerySchema = z.object({
  period: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  tz: z.string().optional(),
  traffic: z.string().optional(),
  noCache: z.coerce.boolean().optional(),
})

export type AnalyticsWindowQuery = z.infer<typeof analyticsWindowQuerySchema>

export function resolveAnalyticsQuery(
  query: AnalyticsWindowQuery,
  nowMs: number = Date.now(),
  defaultPeriod = '30d',
) {
  return {
    window: resolveAnalyticsWindow(query, nowMs, defaultPeriod),
    traffic: resolveAnalyticsTraffic(query.traffic),
  }
}
