/**
 * Calendar parts of an instant in a named time zone, for day keys ("today's
 * puzzle", "today's totals") that must flip at local midnight in the
 * product's zone, never the server's or the browser's. Seven apps carried the
 * same `Intl.DateTimeFormat#formatToParts` dance.
 *
 * The zone is always an argument: reading the host's zone renders one day on
 * the server and another in the browser (see `units.ts`). Import from
 * `@narduk-enterprises/narduk-core/shared/utils/zoned-date`.
 */

export interface ZonedDateParts {
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly month: number
  readonly second: number
  /** 0 = Sunday … 6 = Saturday, in the zone. */
  readonly weekday: number
  readonly year: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * The wall-clock parts of `instant` in `timeZone` (an IANA name such as
 * `America/Chicago`). Throws `RangeError` for an unknown zone or an invalid
 * instant, because a silently wrong day is worse than a loud failure.
 */
export function zonedDateParts(instant: Date | number, timeZone: string): ZonedDateParts {
  const date = typeof instant === 'number' ? new Date(instant) : instant
  if (!Number.isFinite(date.getTime())) throw new RangeError('zonedDateParts: invalid instant')
  const parts: Record<string, string> = {}
  for (const part of formatterFor(timeZone).formatToParts(date)) parts[part.type] = part.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ''),
  }
}

/** `YYYY-MM-DD` for the calendar day `instant` falls on in `timeZone`. */
export function zonedDateKey(instant: Date | number, timeZone: string): string {
  const { year, month, day } = zonedDateParts(instant, timeZone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
