/**
 * Calendar and time-zone arithmetic for analytics windows: the local date of
 * an instant, local midnight (DST-safe), and whole-day shifts.
 *
 * Shared by this module's admin window (`analyticsWindow.ts`) and by the
 * operator portal's fleet window, so the two cut day buckets the same way
 * and cannot drift. Pure, dependency-free and browser-safe.
 */

/** A bad window or time zone: the route answers 400 with this message. */
export class AnalyticsWindowError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsWindowError'
  }
}

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

export interface AnalyticsZoneParts {
  day: number
  hour: number
  minute: number
  month: number
  second: number
  year: number
}

/** One formatter per zone: a 180-day window resolves hundreds of edges. */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let found = formatters.get(tz)
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, found)
  }
  return found
}

/** The wall-clock parts of an instant in a zone. */
export function analyticsZoneParts(ms: number, tz: string): AnalyticsZoneParts {
  const parts = formatter(tz).formatToParts(new Date(ms))
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
  const p = analyticsZoneParts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`

/** The local `YYYY-MM-DD` of an instant. */
export function analyticsLocalDateKey(ms: number, tz: string): string {
  const p = analyticsZoneParts(ms, tz)
  return dateKey(p.year, p.month, p.day)
}

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/u

/** A real calendar date in `YYYY-MM-DD`, or null (`2026-02-30` is null). */
export function parseAnalyticsDateKey(
  value: string,
): { day: number; month: number; year: number } | null {
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
  const parsed = parseAnalyticsDateKey(key)
  if (!parsed) throw new AnalyticsWindowError('Dates are YYYY-MM-DD.')
  const moved = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days))
  return dateKey(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate())
}

/** The UTC instant of local midnight on `key` in `tz` (DST-safe: two passes settle the edge). */
export function analyticsLocalMidnightMs(key: string, tz: string): number {
  const parsed = parseAnalyticsDateKey(key)
  if (!parsed) throw new AnalyticsWindowError('Dates are YYYY-MM-DD.')
  const wall = Date.UTC(parsed.year, parsed.month - 1, parsed.day)
  let guess = wall - zoneOffsetMs(wall, tz)
  guess = wall - zoneOffsetMs(guess, tz)
  return guess
}
