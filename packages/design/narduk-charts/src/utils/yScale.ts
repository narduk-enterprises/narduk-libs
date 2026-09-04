import type { ChartYScaleMode } from '../types'
import { linearScale, niceScale, formatValue } from './math'

export interface YAxisMapResult {
  /** Map data value to distance from plot bottom (px), before `padding.top`. */
  yFromBottom: (value: number) => number
  /** Ticks in data space with precomputed label strings. */
  ticks: { value: number; label: string }[]
  domain: { min: number; max: number }
}

const LOG_FLOOR = 1e-12

/**
 * `count` tick values spread evenly across `[min, max]`, both ends inclusive.
 *
 * Used only when a caller has PINNED the domain. The derived path deliberately
 * goes through `niceScale` instead, which chooses round tick values and moves
 * the domain out to meet them — the right default, and exactly wrong for a
 * pinned domain, where the whole point is that the ends are the numbers the
 * caller named rather than the round ones nearby.
 */
function evenTicks(min: number, max: number, count: number): { value: number; label: string }[] {
  const n = Math.max(2, Math.floor(count))
  const ticks: { value: number; label: string }[] = []
  for (let i = 0; i < n; i++) {
    const value = min + ((max - min) * i) / (n - 1)
    ticks.push({ value, label: formatValue(value) })
  }
  return ticks
}

/** A domain whose ends are used verbatim, with a guard against a zero span. */
function pinnedLinearAxis(
  min: number,
  max: number,
  plotHeight: number,
  tickCount: number,
): YAxisMapResult {
  const hi = max > min ? max : min + 1
  return {
    domain: { min, max: hi },
    ticks: evenTicks(min, hi, tickCount),
    yFromBottom: v => linearScale(v, min, hi, 0, plotHeight),
  }
}

/** Symmetric log (as used in matplotlib): linear near zero, then log. */
export function symlogForward(y: number, linthresh: number): number {
  const c = Math.max(linthresh, LOG_FLOOR)
  if (Math.abs(y) <= c) return y
  return Math.sign(y) * (c + Math.log(Math.abs(y) / c))
}

export function symlogInverse(t: number, linthresh: number): number {
  const c = Math.max(linthresh, LOG_FLOOR)
  const a = Math.abs(t)
  if (a <= c) return t
  return Math.sign(t) * c * Math.exp(a - c)
}

function logTickValues(min: number, max: number, maxTicks = 8): number[] {
  if (min <= 0 || max <= 0 || !Number.isFinite(min) || !Number.isFinite(max)) return []
  const lo = Math.log10(min)
  const hi = Math.log10(max)
  const ticks: number[] = []
  const p0 = Math.floor(lo)
  const p1 = Math.ceil(hi)
  for (let p = p0; p <= p1; p++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** p
      if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v)
    }
  }
  const sorted = [...new Set(ticks)].sort((a, b) => a - b)
  if (sorted.length <= maxTicks) return sorted
  const step = Math.ceil(sorted.length / maxTicks)
  return sorted.filter((_, i) => i % step === 0)
}

/**
 * Build Y mapping from data space to plot height (origin at bottom of plot).
 */
export function createYAxisMap(
  mode: ChartYScaleMode,
  dataValues: number[],
  extraValues: number[],
  plotHeight: number,
  options?: {
    symlogLinthresh?: number
    maxTicks?: number
    linearFromZero?: boolean
    linearPaddingRatio?: number
    /**
     * Pin the domain's floor. Used EXACTLY — the value is not passed through
     * `niceScale`, so a set of charts given the same bound share one scale to
     * the pixel, and a ceiling stated as a series' own maximum stays that
     * number rather than the round one above it.
     */
    domainMin?: number
    /** Pin the domain's ceiling. Same contract as `domainMin`. */
    domainMax?: number
  },
): YAxisMapResult {
  const maxTicks = options?.maxTicks ?? 6
  const linthresh = options?.symlogLinthresh ?? 1
  const all = [...dataValues, ...extraValues].filter(v => Number.isFinite(v))
  /** When true (default), linear Y includes 0 when all values are positive — good for counts, bad for OHLC-only prices. */
  const linearFromZero = options?.linearFromZero !== false

  /*
   * Either end may be pinned on its own: pinning only the ceiling keeps a
   * shared grid maximum while each chart still finds its own floor.
   */
  const pinMin = Number.isFinite(options?.domainMin) ? options!.domainMin! : null
  const pinMax = Number.isFinite(options?.domainMax) ? options!.domainMax! : null
  const pinned = pinMin !== null || pinMax !== null

  if (mode === 'linear') {
    const vals = all
    let low: number
    let high: number
    if (vals.length === 0) {
      low = 0
      high = 100
    } else {
      const rawMin = Math.min(...vals)
      const rawMax = Math.max(...vals)
      const paddingRatio = Math.max(0, options?.linearPaddingRatio ?? 0)
      const rawRange = rawMax - rawMin
      const padding = rawRange > 0
        ? rawRange * paddingRatio
        : Math.max(Math.abs(rawMax), 1) * paddingRatio
      low = linearFromZero ? Math.min(0, rawMin - padding) : rawMin - padding
      high = rawMax + padding
    }

    if (pinned) {
      return pinnedLinearAxis(pinMin ?? low, pinMax ?? high, plotHeight, maxTicks)
    }

    const s = niceScale(low, high, maxTicks)
    return {
      domain: { min: s.min, max: s.max },
      ticks: s.ticks.map(value => ({ value, label: formatValue(value) })),
      yFromBottom: v =>
        linearScale(v, s.min, s.max, 0, plotHeight),
    }
  }

  if (mode === 'log') {
    const pos = all.filter(v => v > 0)
    let minV: number
    let maxV: number
    if (pos.length === 0) {
      minV = 0.1
      maxV = 10
    } else {
      minV = Math.min(...pos)
      maxV = Math.max(...pos)
      if (minV === maxV) {
        minV = minV / 10
        maxV = maxV * 10
      }
    }
    /*
     * A pinned bound wins over the derived one, but a log axis still cannot
     * accept a non-positive floor, so a pin at or below zero is clamped rather
     * than silently producing NaN across the whole plot.
     */
    if (pinMin !== null && pinMin > 0) minV = pinMin
    if (pinMax !== null && pinMax > 0) maxV = pinMax
    const logMin = Math.log10(Math.max(minV, LOG_FLOOR))
    const logMax = Math.log10(Math.max(maxV, minV * 1.0001))
    const tickVals = logTickValues(
      10 ** logMin,
      10 ** logMax,
      maxTicks,
    )
    const ticks = (tickVals.length ? tickVals : [10 ** logMin, 10 ** logMax]).map(value => ({
      value,
      label: formatValue(value),
    }))
    return {
      domain: { min: 10 ** logMin, max: 10 ** logMax },
      yFromBottom: (v: number) => {
        const x = Math.max(v, LOG_FLOOR)
        return linearScale(Math.log10(x), logMin, logMax, 0, plotHeight)
      },
      ticks,
    }
  }

  // symlog
  const transformed = all.map(v => symlogForward(v, linthresh))
  const tMin = transformed.length ? Math.min(...transformed) : -1
  const tMax = transformed.length ? Math.max(...transformed) : 1

  /*
   * Pins are stated in DATA space, so they are transformed before they can be
   * compared with the series' own transformed extent — and the ticks are then
   * spaced evenly in transformed space, which is where a symlog axis is
   * linear, rather than evenly in data space.
   */
  if (pinned) {
    const lo = pinMin !== null ? symlogForward(pinMin, linthresh) : tMin
    const hiRaw = pinMax !== null ? symlogForward(pinMax, linthresh) : tMax
    const hi = hiRaw > lo ? hiRaw : lo + 1
    return {
      domain: { min: symlogInverse(lo, linthresh), max: symlogInverse(hi, linthresh) },
      ticks: evenTicks(lo, hi, maxTicks).map((t) => {
        const value = symlogInverse(t.value, linthresh)
        return { value, label: formatValue(value) }
      }),
      yFromBottom: v =>
        linearScale(symlogForward(v, linthresh), lo, hi, 0, plotHeight),
    }
  }

  const s = niceScale(tMin, tMax, maxTicks)
  return {
    domain: { min: symlogInverse(s.min, linthresh), max: symlogInverse(s.max, linthresh) },
    ticks: s.ticks.map((t) => {
      const value = symlogInverse(t, linthresh)
      return { value, label: formatValue(value) }
    }),
    yFromBottom: v =>
      linearScale(symlogForward(v, linthresh), s.min, s.max, 0, plotHeight),
  }
}

/**
 * Invert the Y axis: distance from the **bottom** of the plot (px) → data value.
 * Use with the same `mode` / `domain` as `createYAxisMap`.
 */
export function dataValueFromBottomPx(
  mode: ChartYScaleMode,
  bottomPx: number,
  plotHeight: number,
  domain: { min: number; max: number },
  options?: { symlogLinthresh?: number },
): number {
  const h = Math.max(1e-9, plotHeight)
  const u = Math.min(1, Math.max(0, bottomPx / h))
  if (mode === 'linear') {
    return domain.min + u * (domain.max - domain.min)
  }
  if (mode === 'log') {
    const lo = Math.log10(Math.max(domain.min, LOG_FLOOR))
    const hi = Math.log10(Math.max(domain.max, domain.min * 1.0001))
    return 10 ** (lo + u * (hi - lo))
  }
  const linthresh = options?.symlogLinthresh ?? 1
  const tMin = symlogForward(domain.min, linthresh)
  const tMax = symlogForward(domain.max, linthresh)
  const t = tMin + u * (tMax - tMin)
  return symlogInverse(t, linthresh)
}
