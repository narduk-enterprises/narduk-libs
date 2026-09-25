/**
 * Longitude arithmetic shared by the geometry helpers and the Nuxt runtime's
 * framing. Internal: not re-exported from `./geometry`, so moving it here did
 * not widen the public surface.
 */

export function normalizeLongitudeDegrees(lng: number): number {
  const normalized = ((((lng + 180) % 360) + 360) % 360) - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

export function toPositiveLongitudeDegrees(lng: number): number {
  return ((lng % 360) + 360) % 360
}

/**
 * Span of a set of longitudes, measured the short way round: the arc left after
 * removing the largest gap between neighbours. Two points either side of the
 * antimeridian (179.5, -179.5) span 1 degree centred on 180, not 359 degrees
 * centred on 0.
 */
export function computeLongitudeSpan(longitudes: number[]): {
  centerLng: number
  crossesAntimeridian: boolean
  eastLng: number
  lngDelta: number
  westLng: number
} {
  if (longitudes.length === 1) {
    const lng = normalizeLongitudeDegrees(longitudes[0]!)
    return { centerLng: lng, crossesAntimeridian: false, eastLng: lng, lngDelta: 0, westLng: lng }
  }

  const sorted = longitudes.map(toPositiveLongitudeDegrees).sort((a, b) => a - b)
  let largestGap = -Infinity
  let largestGapIndex = 0

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!
    const next = sorted[(i + 1) % sorted.length]! + (i === sorted.length - 1 ? 360 : 0)
    const gap = next - current
    if (gap > largestGap) {
      largestGap = gap
      largestGapIndex = i
    }
  }

  const start = sorted[(largestGapIndex + 1) % sorted.length]!
  const span = 360 - largestGap
  const end = (start + span) % 360
  const center = (start + span / 2) % 360

  const westLng = normalizeLongitudeDegrees(start)
  const eastLng = normalizeLongitudeDegrees(end)

  return {
    centerLng: normalizeLongitudeDegrees(center),
    crossesAntimeridian: westLng > eastLng,
    eastLng,
    lngDelta: span,
    westLng,
  }
}
