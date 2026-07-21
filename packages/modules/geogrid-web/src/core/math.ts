import type { GridBBox, GridScale, GridValueRange, GridViewport } from './models.js'

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

/**
 * Inter-frame blend of two encoded uint16 samples (0…65535).
 * Both Canvas2D and WebGL must mix in encoded space so log-scale layers
 * interpolate along the wire quantization (geometric in display units).
 */
export function blendEncoded(lower: number, upper: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  return lower + (upper - lower) * t
}

/**
 * Display value after encoded-space temporal blend — the single formula both backends share.
 */
export function blendedDisplayValue(
  lowerEncoded: number,
  upperEncoded: number,
  progress: number,
  range: GridValueRange,
  scale: GridScale | string,
): number {
  return displayValueFromEncoded(blendEncoded(lowerEncoded, upperEncoded, progress), range, scale)
}

export interface DataUvTransform {
  uvOffsetX: number
  uvOffsetY: number
  uvScaleX: number
  uvScaleY: number
}

/** Map screen UV → data-bbox texture UV for a viewport (same math as WebGL/Canvas blit). */
export function dataUvTransform(viewport: GridViewport, bbox: GridBBox): DataUvTransform {
  const span = viewport.span
  const viewportWest = viewport.center.longitude - span.longitudeDelta / 2
  const viewportNorth = viewport.center.latitude + span.latitudeDelta / 2
  const [west, south, east, north] = bbox
  const bboxWidth = Math.max(1e-9, east - west)
  const bboxHeight = Math.max(1e-9, north - south)
  return {
    uvScaleX: span.longitudeDelta / bboxWidth,
    uvScaleY: span.latitudeDelta / bboxHeight,
    uvOffsetX: (viewportWest - west) / bboxWidth,
    uvOffsetY: (north - viewportNorth) / bboxHeight,
  }
}

/**
 * Content fingerprint for a frame's sample payload (not the date alone).
 * Used so GPU/CPU caches invalidate when the same date is re-decoded with new bytes.
 */
export function frameContentKey(
  date: string,
  width: number,
  height: number,
  values: ArrayLike<number>,
  mask: ArrayLike<number>,
): string {
  const n = Math.min(values.length, mask.length)
  let hash = (width * 73856093) ^ (height * 19349663) ^ (n * 83492791)
  const step = Math.max(1, Math.floor(n / 64))
  for (let i = 0; i < n; i += step) {
    hash = (hash * 31 + (values[i] ?? 0)) | 0
    hash = (hash * 31 + (mask[i] ?? 0)) | 0
  }
  if (n > 0) {
    hash = (hash * 31 + (values[n - 1] ?? 0)) | 0
    hash = (hash * 31 + (mask[n - 1] ?? 0)) | 0
  }
  return `${date}|${width}x${height}|${n}|${hash >>> 0}`
}
