import type { ColorRamp, ColorStop } from './models.js'

export type RGB = readonly [r: number, g: number, b: number]

/** Sample a piecewise-linear ramp at a display value. */
export function sampleRamp(stops: readonly ColorStop[], value: number): RGB {
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last) return [30, 100, 180]
  if (value <= first.value) return [first.r, first.g, first.b]
  if (value >= last.value) return [last.r, last.g, last.b]
  for (let index = 1; index < stops.length; index += 1) {
    const upper = stops[index]!
    const lower = stops[index - 1]!
    if (value <= upper.value) {
      const t = (value - lower.value) / Math.max(1e-12, upper.value - lower.value)
      return [
        Math.round(lower.r + (upper.r - lower.r) * t),
        Math.round(lower.g + (upper.g - lower.g) * t),
        Math.round(lower.b + (upper.b - lower.b) * t),
      ]
    }
  }
  return [last.r, last.g, last.b]
}

/** Build a discrete LUT (default 256 entries) for GPU upload or CPU index sampling. */
export function rampLut(ramp: ColorRamp | readonly ColorStop[], count = 256): RGB[] {
  const stops: readonly ColorStop[] = Array.isArray(ramp)
    ? ramp
    : (ramp as ColorRamp).stops
  if (stops.length === 0 || count <= 0) return []
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const lo = first.value
  const hi = last.value
  const span = hi - lo || 1
  const lut: RGB[] = []
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1)
    lut.push(sampleRamp(stops, lo + t * span))
  }
  return lut
}
