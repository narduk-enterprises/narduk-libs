/**
 * Range, time zone and traffic state for the admin Analytics page, and the
 * query it sends. Pure and clock-injected so every rule is testable.
 *
 * The server owns the window (`server/utils/analyticsWindow.ts`); this file
 * only validates early, so a bad custom range is explained before a request.
 */

export const ADMIN_RANGE_PRESETS = ['1h', '3h', '12h', '24h', '7d', '28d', '30d'] as const
export type AdminRangePreset = (typeof ADMIN_RANGE_PRESETS)[number]
export type AdminRangeChoice = AdminRangePreset | 'custom'
export type AdminTimeZoneChoice = 'local' | 'utc'

/** Mirrors the server: custom ranges stop at 180 days. */
export const ADMIN_RANGE_MAX_DAYS = 180

export const ADMIN_TRAFFIC_CLASS_ORDER = ['unmarked', 'external', 'owner', 'automation'] as const

const DAY = 86_400_000
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u

export interface AdminRangeState {
  end: string
  /** Classes added back while `traffic` is `internal`. */
  includeClasses: string[]
  preset: AdminRangeChoice
  start: string
  /** `external` is the default; `internal` adds the selected classes back. */
  traffic: 'external' | 'internal'
  tz: AdminTimeZoneChoice
}

export const adminRangeDefaults = (): AdminRangeState => ({
  preset: '28d',
  start: '',
  end: '',
  tz: 'local',
  traffic: 'external',
  includeClasses: ['owner', 'automation'],
})

/** Daily buckets (and daily Google data) start at 24 h plus; shorter ranges are sub-day. */
export const adminRangeIsSubDay = (preset: AdminRangeChoice) =>
  preset === '1h' || preset === '3h' || preset === '12h' || preset === '24h'

/** The IANA zone the browser reports, or UTC when it cannot say. */
export function adminLocalTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function adminResolveTimeZone(choice: AdminTimeZoneChoice, local = adminLocalTimeZone()) {
  return choice === 'utc' ? 'UTC' : local
}

/** "CT", "PDT", "GMT+2": the zone's short name at `atMs`, or the id when the runtime has none. */
export function adminTimeZoneName(tz: string, atMs: number = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(atMs)
      .find((item) => item.type === 'timeZoneName')
    return part?.value ?? tz
  } catch {
    return tz
  }
}

/** The local calendar date (`YYYY-MM-DD`) of an instant in a zone. */
export function adminDateKey(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ms)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const keyToUtcDay = (key: string) => {
  if (!DATE_KEY.test(key)) return Number.NaN
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(y, m - 1, d)
  // Reject 2026-02-31 style rollovers.
  return new Date(ms).toISOString().slice(0, 10) === key ? ms / DAY : Number.NaN
}

export function adminAddDays(key: string, days: number): string {
  return new Date((keyToUtcDay(key) + days) * DAY).toISOString().slice(0, 10)
}

/**
 * Why a custom range is not valid yet, or `null`. The end day is excluded,
 * matching the server, and the messages are the server's.
 */
export function adminValidateCustomRange(
  start: string,
  end: string,
  nowMs: number = Date.now(),
  tz = 'UTC',
): string | null {
  if (!start || !end) return 'Pick a start and an end date.'
  const startDay = keyToUtcDay(start)
  const endDay = keyToUtcDay(end)
  if (Number.isNaN(startDay) || Number.isNaN(endDay)) return 'Dates are YYYY-MM-DD.'
  if (endDay <= startDay) return 'End must be after start. The end day is excluded.'
  if (endDay - startDay > ADMIN_RANGE_MAX_DAYS) return `Up to ${ADMIN_RANGE_MAX_DAYS} days.`
  if (end > adminAddDays(adminDateKey(nowMs, tz), 1)) return 'End can’t be after tomorrow.'
  return null
}

/**
 * The traffic value the API takes. `external` is the default; `internal` with
 * every known class selected is `all`; otherwise the exact class list.
 */
export function adminTrafficParam(state: Pick<AdminRangeState, 'includeClasses' | 'traffic'>) {
  if (state.traffic === 'external') return 'external'
  const added = [...new Set(state.includeClasses)].filter((item) => item !== 'unmarked').sort()
  if (added.length === 0) return 'external'
  if (added.includes('owner') && added.includes('automation') && added.length === 2) return 'all'
  return ['unmarked', ...added].sort().join(',')
}

/** The query every PostHog read takes. */
export function adminRangeQuery(
  state: AdminRangeState,
  local = adminLocalTimeZone(),
): Record<string, string> {
  const query: Record<string, string> = {
    tz: adminResolveTimeZone(state.tz, local),
    traffic: adminTrafficParam(state),
  }
  if (state.preset === 'custom') {
    query.start = state.start
    query.end = state.end
  } else {
    query.period = state.preset
  }
  return query
}

/**
 * The inclusive local dates a range covers, for the daily-only Google reads.
 * `null` for a sub-day preset: Google has no hourly data, so the page says so
 * instead of showing a day's figure as the range's.
 */
export function adminRangeDates(
  state: AdminRangeState,
  nowMs: number = Date.now(),
  local = adminLocalTimeZone(),
): { endDate: string; startDate: string } | null {
  if (adminRangeIsSubDay(state.preset)) return null
  const tz = adminResolveTimeZone(state.tz, local)
  if (state.preset === 'custom') {
    if (adminValidateCustomRange(state.start, state.end, nowMs, tz)) return null
    return { startDate: state.start, endDate: adminAddDays(state.end, -1) }
  }
  const days = Number.parseInt(state.preset, 10)
  const today = adminDateKey(nowMs, tz)
  return { startDate: adminAddDays(today, -(days - 1)), endDate: today }
}

/** The nearest range Google can answer, offered when a sub-day range has no Google figure. */
export const ADMIN_NEAREST_DAILY: AdminRangePreset = '7d'

// ── labels ───────────────────────────────────────────────────────────────

/** Whole minutes and hours, "3 h 12 m", for how old a cached read is. */
export function adminAgeLabel(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} m`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}

export type AdminFreshness = 'fresh' | 'stale'

/**
 * A read is stale when it is older than twice the age a fresh read of this
 * range can be (the server caches sub-day ranges for a minute, the rest for
 * five), so a normal cache hit never raises the banner.
 */
export function adminFreshness(
  fetchedAt: string | undefined,
  preset: AdminRangeChoice,
  nowMs: number = Date.now(),
): { age: string; ageMs: number; state: AdminFreshness } | null {
  const fetched = fetchedAt ? Date.parse(fetchedAt) : Number.NaN
  if (Number.isNaN(fetched)) return null
  const ageMs = Math.max(0, nowMs - fetched)
  const limit = (adminRangeIsSubDay(preset) ? 1 : 5) * 2 * 60_000
  return { ageMs, age: adminAgeLabel(ageMs), state: ageMs > limit ? 'stale' : 'fresh' }
}

export function adminFormatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

/** Change against the previous equal range; `null` when there is nothing to compare to. */
export function adminDelta(
  current: number,
  previous: number,
): { label: string; sign: -1 | 0 | 1 } | null {
  if (previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) < 0.5) return { label: '0%', sign: 0 }
  return {
    label: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`,
    sign: pct > 0 ? 1 : -1,
  }
}

/** The message of a failed `$fetch`, in the page's words. */
export function adminErrorText(error: unknown): string {
  const err = error as {
    data?: { statusMessage?: string }
    statusCode?: number
    statusMessage?: string
  } | null
  return err?.data?.statusMessage ?? err?.statusMessage ?? 'The request failed.'
}

export type AdminSourceFailure = 'denied' | 'failed' | 'not_configured'

/** What kind of failure a read hit, so the page can say "Not measured" rather than show a zero. */
export function adminClassifyFailure(error: unknown): AdminSourceFailure {
  const err = error as {
    data?: { data?: { state?: string }; statusCode?: number }
    statusCode?: number
  } | null
  const status = err?.statusCode ?? err?.data?.statusCode
  if (status === 401 || status === 403) return 'denied'
  const text = adminErrorText(error)
  if (err?.data?.data?.state === 'not_configured' || /not configured/iu.test(text)) {
    return 'not_configured'
  }
  return 'failed'
}

/** "[8 Sep 00:00 → 6 Oct 00:00) CT": the half-open window in the display zone. */
export function adminRangeLine(fromIso: string, toIso: string, tz: string): string {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return ''
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `[${format.format(from)} → ${format.format(to)}) ${adminTimeZoneName(tz, to)}`
}

/** The last event's time in the display zone, "Oct 4, 3:12 PM". */
export function adminFormatMoment(iso: string | null, tz: string): string {
  const ms = iso ? Date.parse(iso) : Number.NaN
  if (Number.isNaN(ms)) return 'none'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms)
}
