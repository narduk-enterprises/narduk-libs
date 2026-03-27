import type { ChartSeries, HistogramBin, CandleBar } from '../types'

export interface ScaleResult {
  min: number
  max: number
  step: number
  ticks: number[]
}

/**
 * Compute "nice" axis bounds and tick marks for a given data range.
 * Rounds min/max outward to clean multiples and chooses step sizes
 * from {1, 2, 5} × 10^n so labels read naturally.
 */
export function niceScale(minVal: number, maxVal: number, maxTicks = 6): ScaleResult {
  if (minVal === maxVal) {
    const offset = minVal === 0 ? 1 : Math.abs(minVal) * 0.1
    return niceScale(minVal - offset, maxVal + offset, maxTicks)
  }

  const range = maxVal - minVal
  const roughStep = range / (maxTicks - 1)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const residual = roughStep / magnitude

  let niceStep: number
  if (residual <= 1.5) niceStep = magnitude
  else if (residual <= 3) niceStep = 2 * magnitude
  else if (residual <= 7) niceStep = 5 * magnitude
  else niceStep = 10 * magnitude

  const niceMin = Math.floor(minVal / niceStep) * niceStep
  const niceMax = Math.ceil(maxVal / niceStep) * niceStep

  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
    ticks.push(Number.parseFloat(v.toFixed(10)))
  }

  return { min: niceMin, max: niceMax, step: niceStep, ticks }
}

export function linearScale(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin)
}

/**
 * Convert a series of points into a smooth SVG cubic-bezier path
 * using Catmull-Rom → Bezier conversion (uniform parameterisation).
 */
export function catmullRomPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    return `M${points[0][0]},${points[0][1]}L${points[1][0]},${points[1][1]}`
  }

  let d = `M${points[0][0]},${points[0][1]}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6

    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`
  }

  return d
}

export function straightPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
}

/**
 * Split a series into continuous segments wherever values are `null` or `NaN`.
 */
export function segmentLinePoints(
  data: (number | null)[],
  toPoint: (index: number, value: number) => [number, number],
): [number, number][][] {
  const segments: [number, number][][] = []
  let cur: [number, number][] = []
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v == null || Number.isNaN(v)) {
      if (cur.length) {
        segments.push(cur)
        cur = []
      }
    } else {
      cur.push(toPoint(i, v))
    }
  }
  if (cur.length) segments.push(cur)
  return segments
}

export function lineSegmentsToPaths(
  segments: [number, number][][],
  smooth: boolean,
): string[] {
  return segments.map(seg =>
    seg.length < 2 ? '' : smooth ? catmullRomPath(seg) : straightPath(seg),
  )
}

/** Close a line path down to a horizontal baseline (for area fill). */
export function closeAreaUnderLine(
  lineD: string,
  segment: [number, number][],
  yBaseline: number,
): string {
  if (!lineD || segment.length < 2) return ''
  const x0 = segment[0][0]
  const x1 = segment[segment.length - 1][0]
  return `${lineD} L ${x1} ${yBaseline} L ${x0} ${yBaseline} Z`
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  }
}

/**
 * Build an SVG arc path for a pie/donut slice.
 * Angles are in radians, measured clockwise from 12 o'clock (-π/2).
 */
export function describeArc(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

  if (innerRadius <= 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      'Z',
    ].join(' ')
  }

  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle)

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

export function formatValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  if (Number.isInteger(value)) return value.toString()
  return value.toFixed(1)
}

/**
 * Axis tick label: avoid collapsing distinct prices to the same string (e.g. 21050
 * and 21100 both becoming "21.1K") when the visible domain is tight vs magnitude.
 */
export function formatAxisTickValue(domainMin: number, domainMax: number, value: number): string {
  const span = Math.abs(domainMax - domainMin)
  if (!Number.isFinite(value) || !Number.isFinite(span)) return formatValue(value)
  if (span === 0) return formatValue(value)

  const mag = Math.max(Math.abs(domainMin), Math.abs(domainMax), Math.abs(value), 1e-12)
  const relSpan = span / mag
  const abs = Math.abs(value)

  if (abs >= 1_000_000) {
    const dec = relSpan < 0.05 ? 2 : 1
    return `${(value / 1_000_000).toFixed(dec)}M`
  }
  if (abs >= 1000) {
    if (relSpan < 0.12) return `${(value / 1000).toFixed(2)}K`
    return formatValue(value)
  }
  if (Number.isInteger(value) && span >= 10) return value.toString()
  const decimals = span < 0.01 ? 4 : span < 0.1 ? 3 : span < 1 ? 3 : span < 10 ? 2 : 1
  return value.toFixed(decimals)
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

export interface DecimatedCategoryData {
  labels: string[]
  series: ChartSeries[]
}

/**
 * Evenly subsample categories for large datasets (same indices across all series).
 * Use when `!zoomable` or when you accept zoom operating on decimated indices.
 */
export function decimateCategoryData(
  labels: string[],
  series: ChartSeries[],
  maxPoints: number,
): DecimatedCategoryData {
  const n = labels.length
  if (n <= maxPoints || maxPoints < 2) {
    return {
      labels: [...labels],
      series: series.map(s => ({ ...s, data: [...s.data] })),
    }
  }
  const idx: number[] = []
  for (let i = 0; i < maxPoints; i++) {
    idx.push(Math.round((i * (n - 1)) / Math.max(1, maxPoints - 1)))
  }
  const uniq = [...new Set(idx)].sort((a, b) => a - b)
  const newLabels = uniq.map(i => labels[i] ?? '')
  const newSeries = series.map(s => ({
    ...s,
    data: uniq.map(i => s.data[i] ?? null),
  }))
  return { labels: newLabels, series: newSeries }
}

export function computeHistogramBins(values: number[], binCount: number): HistogramBin[] {
  if (values.length === 0 || binCount < 1) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    return [{ start: min, end: max, count: values.length }]
  }
  const w = (max - min) / binCount
  const bins = Array.from({ length: binCount }, (_, i) => ({
    start: min + i * w,
    end: min + (i + 1) * w,
    count: 0,
  }))
  for (const v of values) {
    const i = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / w)))
    bins[i].count += 1
  }
  return bins
}

export interface XYPoint {
  x: number
  y: number
}

/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson) for line/scatter paths.
 */
export function largestTriangleThreeBuckets(points: XYPoint[], threshold: number): XYPoint[] {
  if (threshold < 3 || points.length <= threshold) return points.slice()
  const sampled: XYPoint[] = []
  const bucketSize = (points.length - 2) / (threshold - 2)
  let a = 0
  sampled.push(points[a]!)
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 0) * bucketSize) + 1
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length)
    let avgX = 0
    let avgY = 0
    const arLen = Math.max(1, avgRangeEnd - avgRangeStart)
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += points[j]!.x
      avgY += points[j]!.y
    }
    avgX /= arLen
    avgY /= arLen
    let maxArea = -1
    let maxIdx = rangeStart
    const pa = points[a]!
    for (let j = rangeStart; j < rangeEnd; j++) {
      const pj = points[j]!
      const area = Math.abs(
        (pa.x - avgX) * (pj.y - pa.y) - (pa.x - pj.x) * (avgY - pa.y),
      ) * 0.5
      if (area > maxArea) {
        maxArea = area
        maxIdx = j
      }
    }
    sampled.push(points[maxIdx]!)
    a = maxIdx
  }
  sampled.push(points[points.length - 1]!)
  return sampled
}

export interface AggregatedCandleBucket {
  bar: CandleBar
  /** Inclusive slice indices relative to the `bars` argument. */
  i0: number
  i1: number
}

/** Merge contiguous candles into at most `maxBuckets` bars (for drawing dense history). */
export function aggregateCandles(bars: CandleBar[], maxBuckets: number): CandleBar[] {
  return aggregateCandlesDetailed(bars, maxBuckets).map(b => b.bar)
}

/** Same as `aggregateCandles` but keeps index ranges for layout and hit-testing. */
export function aggregateCandlesDetailed(
  bars: CandleBar[],
  maxBuckets: number,
): AggregatedCandleBucket[] {
  if (bars.length === 0) return []
  if (bars.length <= maxBuckets || maxBuckets < 2) {
    return bars.map((bar, i) => ({ bar, i0: i, i1: i }))
  }
  const k = maxBuckets
  const out: AggregatedCandleBucket[] = []
  const chunk = bars.length / k
  for (let b = 0; b < k; b++) {
    const i0 = Math.floor(b * chunk)
    const i1 = Math.min(bars.length - 1, Math.ceil((b + 1) * chunk) - 1)
    if (i0 > i1) continue
    const sub = bars.slice(i0, i1 + 1)
    let h = -Infinity
    let l = Infinity
    let v = 0
    for (const x of sub) {
      h = Math.max(h, x.h)
      l = Math.min(l, x.l)
      v += x.v ?? 0
    }
    out.push({
      i0,
      i1,
      bar: {
        t: sub[0]!.t,
        o: sub[0]!.o,
        h,
        l,
        c: sub[sub.length - 1]!.c,
        v: v > 0 ? v : undefined,
      },
    })
  }
  return out
}

/** Linear time (ms) at fractional bar index along sorted `bars`. */
export function candleTimeAtIndex(bars: CandleBar[], index: number): number {
  const n = bars.length
  if (n === 0) return 0
  if (n === 1) return bars[0]!.t
  const full = n - 1
  const x = Math.min(full, Math.max(0, index))
  const i = Math.floor(x)
  const f = x - i
  if (i >= full) return bars[full]!.t
  const t0 = bars[i]!.t
  const t1 = bars[i + 1]!.t
  return t0 + f * (t1 - t0)
}

/** Fractional bar index for a time (ms); clamps to `[0, bars.length - 1]`. */
export function candleIndexAtTime(bars: CandleBar[], tMs: number): number {
  const n = bars.length
  if (n === 0) return 0
  if (n === 1) return 0
  if (tMs <= bars[0]!.t) return 0
  if (tMs >= bars[n - 1]!.t) return n - 1
  let lo = 0
  let hi = n - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (bars[mid]!.t <= tMs) lo = mid
    else hi = mid
  }
  const i = lo
  const t0 = bars[i]!.t
  const t1 = bars[i + 1]!.t
  if (t1 === t0) return i
  return i + (tMs - t0) / (t1 - t0)
}
