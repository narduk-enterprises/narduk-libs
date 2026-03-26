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
  options?: { symlogLinthresh?: number; maxTicks?: number; linearFromZero?: boolean },
): YAxisMapResult {
  const maxTicks = options?.maxTicks ?? 6
  const linthresh = options?.symlogLinthresh ?? 1
  const all = [...dataValues, ...extraValues].filter(v => Number.isFinite(v))
  /** When true (default), linear Y includes 0 when all values are positive — good for counts, bad for OHLC-only prices. */
  const linearFromZero = options?.linearFromZero !== false

  if (mode === 'linear') {
    const vals = all
    if (vals.length === 0) {
      const s = niceScale(0, 100, maxTicks)
      return {
        domain: { min: s.min, max: s.max },
        ticks: s.ticks.map(value => ({ value, label: formatValue(value) })),
        yFromBottom: v =>
          linearScale(v, s.min, s.max, 0, plotHeight),
      }
    }
    const rawMin = Math.min(...vals)
    const rawMax = Math.max(...vals)
    const low = linearFromZero ? Math.min(0, rawMin) : rawMin
    const s = niceScale(low, rawMax, maxTicks)
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
