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

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}
