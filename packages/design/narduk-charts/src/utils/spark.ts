import { linearScale, lineSegmentsToPaths, segmentLinePoints } from './math'

export const SPARK_WINDOWS = ['24h', '7d', '30d'] as const
export type SparkWindowId = (typeof SPARK_WINDOWS)[number]

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Inclusive trailing windows used by marine / KPI tiles (buoys, stonx). */
export const SPARK_WINDOW_MS = {
  '24h': 24 * HOUR_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
} as const satisfies Record<SparkWindowId, number>

export function sparkWindowMs(window: SparkWindowId): number {
  return SPARK_WINDOW_MS[window]
}

export type SparkAxisMode = 'linear' | 'fromZero'

export interface SparkAxis {
  max: number
  min: number
  mode: SparkAxisMode
}

export interface SparkAxisOptions {
  /** Force the domain instead of choosing from the values. */
  mode?: SparkAxisMode
  /** Extra headroom as a fraction of the raw span. Default `0.08`. */
  padRatio?: number
}

/**
 * Choose a Y domain for a micro-sparkline.
 *
 * All-non-negative series whose floor sits close to zero (wave height, wind
 * that includes calm) pin `min` at 0. Tight bands far from zero (water
 * temperature, pressure) stay linear so the path still moves.
 */
export function sparkAxis(
  values: Array<number | null | undefined>,
  options: SparkAxisOptions = {},
): SparkAxis {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (finite.length === 0) return { max: 1, min: 0, mode: options.mode ?? 'linear' }

  const rawMin = Math.min(...finite)
  const rawMax = Math.max(...finite)
  const padRatio = options.padRatio ?? 0.08
  const mode = options.mode ?? chooseSparkAxisMode(rawMin, rawMax)

  if (mode === 'fromZero') {
    const top = rawMax <= 0 ? 1 : rawMax
    const pad = Math.max(top * padRatio, Number.EPSILON)
    return { max: top + pad, min: 0, mode }
  }

  if (rawMin === rawMax) {
    const pad = Math.abs(rawMin) * padRatio || 1
    return { max: rawMin + pad, min: rawMin - pad, mode }
  }

  const pad = (rawMax - rawMin) * padRatio
  return { max: rawMax + pad, min: rawMin - pad, mode }
}

function chooseSparkAxisMode(min: number, max: number): SparkAxisMode {
  if (min < 0) return 'linear'
  const span = max - min
  if (span === 0) return min === 0 ? 'fromZero' : 'linear'
  return min <= span * 0.35 ? 'fromZero' : 'linear'
}

export interface SparkPathOptions {
  axis?: SparkAxis
  /** Inset in px so a 1px stroke is not clipped. Default `1`. */
  inset?: number
  smooth?: boolean
}

/**
 * SVG path `d` for a micro-sparkline. Null / NaN values break the line.
 * A series with fewer than two finite neighbours returns `''`.
 */
export function sparkPath(
  values: Array<number | null | undefined>,
  width: number,
  height: number,
  options: SparkPathOptions = {},
): string {
  if (!(width > 0) || !(height > 0)) return ''

  const axis = options.axis ?? sparkAxis(values)
  const inset = options.inset ?? 1
  const innerWidth = Math.max(0, width - inset * 2)
  const innerHeight = Math.max(0, height - inset * 2)
  const last = Math.max(1, values.length - 1)

  const segments = segmentLinePoints(
    values.map(value => (value == null || Number.isNaN(value) ? null : value)),
    (index, value) => [
      inset + linearScale(index, 0, last, 0, innerWidth),
      inset + linearScale(value, axis.max, axis.min, 0, innerHeight),
    ],
  )

  return lineSegmentsToPaths(segments, options.smooth === true)
    .filter(Boolean)
    .join(' ')
}

export interface SparkTimedPoint {
  t: number
  v?: number | null
}

/**
 * Keep samples whose `t` falls in the trailing window ending at `now`.
 * When `now` is omitted, the latest finite `t` is the end (a stale station
 * still shows its own last 24h / 7d / 30d, not an empty wall-clock window).
 */
export function trailingSparkWindow<T extends SparkTimedPoint>(
  points: readonly T[],
  window: SparkWindowId,
  now?: number,
): T[] {
  const end = resolveWindowEnd(points, now)
  const start = end - sparkWindowMs(window)
  return points.filter(point => {
    const time = point.t
    return Number.isFinite(time) && time >= start && time <= end
  })
}

function resolveWindowEnd(points: readonly SparkTimedPoint[], now?: number): number {
  if (now != null && Number.isFinite(now)) return now
  let latest = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (Number.isFinite(point.t) && point.t > latest) latest = point.t
  }
  return Number.isFinite(latest) ? latest : Date.now()
}
