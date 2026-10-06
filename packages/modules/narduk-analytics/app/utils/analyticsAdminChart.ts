/** Geometry and labels for the admin Analytics chart. Pure; no DOM. */

import { adminFormatCount } from './analyticsAdminRange'

export type AdminChartBucket = '1d' | '1h' | '5m' | '15m'

/** A figure as the chart words it: a missing one is "Not measured", never 0. */
export const adminShownValue = (value: number | null | undefined) =>
  value === null || value === undefined ? 'Not measured' : adminFormatCount(value)

/** The largest "nice" value at or above `max`, and ticks up to it. */
export function adminChartScale(max: number, steps = 4): { max: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] }
  const rough = max / steps
  const power = 10 ** Math.floor(Math.log10(rough))
  const unit =
    [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= rough) ?? power * 10
  const top = Math.ceil(max / unit) * unit
  const ticks: number[] = []
  for (let value = 0; value <= top + unit / 1000; value += unit)
    ticks.push(Math.round(value * 1000) / 1000)
  return { max: top, ticks }
}

/** Bar height as a 0-100 percentage; a non-zero value always shows at least a sliver. */
export function adminBarPercent(value: number, scaleMax: number): number {
  if (value <= 0 || scaleMax <= 0) return 0
  return Math.min(100, Math.max(1.5, (value / scaleMax) * 100))
}

/** The slot index under a pointer at `offsetX` in a chart `width` wide. */
export function adminIndexFromOffset(offsetX: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return -1
  return Math.min(count - 1, Math.max(0, Math.floor((offsetX / width) * count)))
}

/** The next slot for a key press, or `null` when the key is not a chart key. */
export function adminStepIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  const from = current < 0 ? 0 : current
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(count - 1, from + 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return current < 0 ? count - 1 : Math.max(0, from - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'PageDown':
      return Math.min(count - 1, from + 7)
    case 'PageUp':
      return Math.max(0, from - 7)
    default:
      return null
  }
}

/** The centre x (0-100) of slot `index`, so a trend point lines up with its bar. */
export function adminSlotCentre(index: number, count: number): number {
  return count <= 0 ? 0 : ((index + 0.5) / count) * 100
}

/** The y (0-100, downward) of a value on a chart scaled to `scaleMax`. */
export function adminValueY(value: number, scaleMax: number): number {
  return 100 - Math.min(100, (Math.max(0, value) / scaleMax) * 100)
}

/**
 * A CSS `polygon()` of the area under a trend, each point on its slot's centre
 * so it lines up with the bars. A `null` ("not measured") is skipped, never
 * drawn as zero. `dropPx` lowers the top edge: stacked under a second,
 * undropped polygon it leaves a line of that width.
 */
export function adminTrendPolygon(
  values: Array<number | null>,
  scaleMax: number,
  dropPx = 0,
): string {
  if (scaleMax <= 0) return ''
  const points = values.flatMap((value, index) =>
    value === null
      ? []
      : [
          {
            x: adminSlotCentre(index, values.length).toFixed(2),
            y: adminValueY(value, scaleMax).toFixed(2),
          },
        ],
  )
  const first = points.at(0)
  const last = points.at(-1)
  if (!first || !last) return ''
  const edge = points.map((point) =>
    dropPx > 0 ? `${point.x}% calc(${point.y}% + ${dropPx}px)` : `${point.x}% ${point.y}%`,
  )
  return `polygon(${first.x}% 100%, ${edge.join(', ')}, ${last.x}% 100%)`
}

const formatter = (tz: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options })
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options })
  }
}

/** A slot's label in the display zone: a date for day buckets, a clock time for finer ones. */
export function adminSlotLabel(
  slot: { endMs: number; key: string; startMs: number },
  bucket: AdminChartBucket,
  tz: string,
  style: 'axis' | 'full' = 'full',
): string {
  if (bucket === '1d') {
    // The key is already the local calendar date; format it as a UTC date so no zone shifts it.
    const [y, m, d] = slot.key.split('-').map(Number) as [number, number, number]
    return formatter('UTC', {
      month: 'short',
      day: 'numeric',
      ...(style === 'full' ? { weekday: 'short' } : {}),
    }).format(Date.UTC(y, m - 1, d))
  }
  const clock = formatter(tz, { hour: 'numeric', minute: '2-digit' })
  if (style === 'axis') return clock.format(slot.startMs)
  const day = formatter(tz, { month: 'short', day: 'numeric' })
  return `${day.format(slot.startMs)}, ${clock.format(slot.startMs)} – ${clock.format(slot.endMs)}`
}

/** Indices (about `target` of them) to label on the axis, always including the first. */
export function adminAxisIndices(count: number, target = 6): number[] {
  if (count <= 0) return []
  if (count <= target) return Array.from({ length: count }, (_, index) => index)
  const step = Math.ceil(count / target)
  const out: number[] = []
  for (let index = 0; index < count; index += step) out.push(index)
  return out
}

/** The last bucket is still filling when "now" falls inside it. */
export function adminSlotInProgress(slot: { endMs: number; startMs: number }, nowMs: number) {
  return nowMs >= slot.startMs && nowMs < slot.endMs
}

/** A chart series is "daily" when each slot is a calendar day. */
export function adminIsDailyBucket(bucket: AdminChartBucket) {
  return bucket === '1d'
}
