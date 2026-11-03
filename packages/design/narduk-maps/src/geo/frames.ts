// Frame time: the playhead is a real number of UTC days, so the timeline is proportional to real time
// and a missing date is a visible gap, never a pretend frame.

const DAY_MS = 86_400_000
const FRAME_TIME = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})(?::(\d{2}))?Z?)?$/

/** UTC day number of a frame time: `YYYY-MM-DD` is whole, `YYYY-MM-DDTHHZ` adds the hour. */
export function dayNumber(time: string): number {
  const m = FRAME_TIME.exec(time)
  if (!m) return Number.NaN
  const day = Math.round(Date.parse(`${m[1]}T00:00:00Z`) / DAY_MS)
  return day + (Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60) / 24
}

/** An hourly (or finer) frame time carries a clock time; a daily one is a whole UTC date. */
export function isTimed(time: string): boolean {
  return Boolean(FRAME_TIME.exec(time)?.[2])
}

function instant(time: string): Date {
  const m = FRAME_TIME.exec(time)
  return new Date(`${m?.[1] ?? time.slice(0, 10)}T${m?.[2] ?? '00'}:${m?.[3] ?? '00'}:00Z`)
}

/** The playhead as a frame-time string to the minute (`2026-11-03T14:30Z`). */
export function playheadTime(day: number): string {
  return `${new Date(Math.round(day * 1440) * 60_000).toISOString().slice(0, 16)}Z`
}

// Hourly frames read in the viewer's own clock, with the zone named on the long form.
const clockFormats = new Map<string, { long: Intl.DateTimeFormat; short: Intl.DateTimeFormat }>()
function clock(timeZone?: string) {
  const key = timeZone ?? ''
  let f = clockFormats.get(key)
  if (!f) {
    f = {
      short: new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone,
      }),
      long: new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
        timeZone,
      }),
    }
    clockFormats.set(key, f)
  }
  return f
}

/** Day name for a timeline label ("Tue"), in the viewer's clock. */
export function weekdayOf(time: string, timeZone?: string): string {
  return clock(timeZone).short.format(instant(time)).split(' ')[0]!
}

/** Typical spacing between frames in days (the median gap), never below an hour. */
export function frameSpacing(days: number[]): number {
  if (days.length < 2) return 1
  const gaps = days
    .slice(1)
    .map((d, i) => d - days[i]!)
    .sort((a, b) => a - b)
  return Math.max(gaps[Math.floor(gaps.length / 2)]!, 1 / 24)
}

export function dateOfDay(day: number): string {
  return new Date(Math.floor(day) * DAY_MS).toISOString().slice(0, 10)
}

export interface FrameAt {
  /** Index of the frame at or before the playhead. */
  a: number
  /** Index of the next frame (equal to `a` at the ends). */
  b: number
  /** Days between the two frames (0 at the ends). */
  span: number
  /** 0 at frame a, 1 at frame b. */
  t: number
}

/** Where the playhead sits among frames whose day numbers are ascending. */
export function frameAt(days: number[], playhead: number): FrameAt {
  const n = days.length
  if (n === 0) return { a: 0, b: 0, t: 0, span: 0 }
  if (playhead <= days[0]!) return { a: 0, b: 0, t: 0, span: 0 }
  if (playhead >= days[n - 1]!) return { a: n - 1, b: n - 1, t: 0, span: 0 }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (days[mid]! <= playhead) lo = mid
    else hi = mid
  }
  const span = days[hi]! - days[lo]!
  return { a: lo, b: hi, t: span > 0 ? (playhead - days[lo]!) / span : 0, span }
}

/** Interpolation shows only when the playhead is clearly between two frames. */
export function isBetween(f: FrameAt): boolean {
  return f.a !== f.b && f.t > 0.02 && f.t < 0.98
}

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const LONG = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/** "Nov 1" for a daily frame, "Tue 14:00" for an hourly one. */
export function shortDate(time: string, timeZone?: string): string {
  if (isTimed(time)) return clock(timeZone).short.format(instant(time))
  return SHORT.format(new Date(`${time.slice(0, 10)}T00:00:00Z`))
}

/** "Sun, Nov 1" for a daily frame, "Tue, Nov 3, 14:00 CST" for an hourly one. */
export function longDate(time: string, timeZone?: string): string {
  if (isTimed(time)) return clock(timeZone).long.format(instant(time))
  return LONG.format(new Date(`${time.slice(0, 10)}T00:00:00Z`))
}

/** The playhead as a URL value: a date on a frame, else the date and UTC hour (2026-10-16T12). */
export function encodePlayhead(day: number): string {
  const whole = Math.floor(day + 1e-6)
  const hour = Math.round((day - whole) * 24)
  if (hour <= 0) return dateOfDay(whole)
  if (hour >= 24) return dateOfDay(whole + 1)
  return `${dateOfDay(whole)}T${String(hour).padStart(2, '0')}`
}

export function decodePlayhead(value: string | undefined | null): number | undefined {
  if (!value) return undefined
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{1,2}))?$/.exec(value.trim())
  if (!m) return undefined
  const day = dayNumber(m[1]!)
  if (!Number.isFinite(day)) return undefined
  const hour = m[2] ? Math.min(Number(m[2]), 23) : 0
  return day + hour / 24
}

/** "Oct 15–18" or "Oct 31–Nov 1": the two frames a blended picture sits between. */
export function spanLabel(a: string, b: string): string {
  if (isTimed(a) || isTimed(b)) return `${shortDate(a)}–${shortDate(b)}`
  const [ma, da] = shortDate(a).split(' ')
  const [mb, db] = shortDate(b).split(' ')
  return ma === mb ? `${ma} ${da}–${db}` : `${ma} ${da}–${mb} ${db}`
}

/**
 * The frames to load ahead of the playhead but not draw yet: the next `ahead` after frame b, so
 * playback never waits on the network. Indexes past the end are dropped by the field layer.
 */
export function prefetchFrames(f: FrameAt, ahead = 2): number[] {
  return Array.from({ length: Math.max(0, ahead) }, (_, i) => f.b + 1 + i)
}
