import type { GridScale, GridValueRange } from './models.js'

/**
 * Normalize a display value into 0…1 for ramp lookup.
 * Byte-compatible intent with GeoGridKit `GridValueMapper.normalizedValue`.
 */
export function normalizeValue(
  value: number,
  range: GridValueRange,
  scale: GridScale,
): number | null {
  if (!Number.isFinite(value)) return null
  const lower = range.lowerBound
  const upper = range.upperBound
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower === upper) return null

  let normalized: number
  if (scale === 'log') {
    if (!(value > 0) || !(lower > 0) || !(upper > 0)) return null
    normalized = (Math.log(value) - Math.log(lower)) / (Math.log(upper) - Math.log(lower))
  } else {
    normalized = (value - lower) / (upper - lower)
  }

  if (!Number.isFinite(normalized)) return null
  return Math.max(0, Math.min(1, normalized))
}

/**
 * Map a 0…65535 encoded scalar sample back to display units given the layer range/scale.
 * Used by Canvas2D and shared with WebGL fragment `displayValue` math.
 */
export function displayValueFromEncoded(
  encoded: number,
  range: GridValueRange,
  scale: GridScale | string,
): number {
  const normalized = Math.max(0, Math.min(1, encoded / 65535))
  const [min, max] = [range.lowerBound, range.upperBound]
  if (scale === 'log' && min > 0 && max > 0) {
    return 10 ** (Math.log10(min) + normalized * (Math.log10(max) - Math.log10(min)))
  }
  return min + normalized * (max - min)
}
