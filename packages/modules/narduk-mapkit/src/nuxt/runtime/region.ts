/**
 * Bounding-region arithmetic for `<AppMapKit>`.
 *
 * Pure: it takes points and returns a plain region, so the caller decides when a
 * `mapkit.CoordinateRegion` gets constructed. That keeps the framing rules
 * testable without a map, a namespace, or a DOM.
 */

import { computeLongitudeSpan } from '../../geometry/longitude.js'

export interface MapKitLatLng {
  lat: number
  lng: number
}

export interface MapKitPlainRegion {
  center: MapKitLatLng
  span: { lat: number; lng: number }
}

export interface MapKitBoundsOptions {
  /** Fraction of the natural span added as breathing room. */
  boundingPadding?: number
  fallbackCenter?: MapKitLatLng | undefined
  /** Floor for both deltas, so a single point still shows context. */
  minSpanDelta?: number
}

const MIN_LAT_DELTA = 0.005
const MIN_LNG_DELTA = 0.006
const FALLBACK_LAT_DELTA = 0.08
const FALLBACK_LNG_DELTA = 0.1

/**
 * The region that frames every supplied point.
 *
 * Returns `undefined` when there is nothing to frame and no `fallbackCenter`,
 * so a caller can tell "nothing to show" from "show this".
 */
export function mapKitBoundingRegion(
  points: Iterable<MapKitLatLng>,
  options: MapKitBoundsOptions = {},
): MapKitPlainRegion | undefined {
  let maxLat = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  const longitudes: number[] = []

  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue
    if (point.lat < minLat) minLat = point.lat
    if (point.lat > maxLat) maxLat = point.lat
    longitudes.push(point.lng)
  }

  if (longitudes.length > 0) {
    // Longitude is measured the short way round, so points either side of the
    // antimeridian frame the narrow strip between them (narduk-libs#868).
    const { centerLng, lngDelta } = computeLongitudeSpan(longitudes)
    const padding = options.boundingPadding ?? 0.05
    const floor = options.minSpanDelta ?? 0
    return {
      center: { lat: (minLat + maxLat) / 2, lng: centerLng },
      span: {
        lat: Math.max((maxLat - minLat) * (1 + padding), floor, MIN_LAT_DELTA),
        lng: Math.max(lngDelta * (1 + padding), floor, MIN_LNG_DELTA),
      },
    }
  }

  const fallback = options.fallbackCenter
  if (!fallback) return undefined
  return {
    center: { lat: fallback.lat, lng: fallback.lng },
    span: { lat: FALLBACK_LAT_DELTA, lng: FALLBACK_LNG_DELTA },
  }
}

/** Every `[lng, lat]` pair in a GeoJSON geometry the component renders. */
export function mapKitGeometryPoints(geometry: {
  coordinates: unknown
  type: string
}): MapKitLatLng[] {
  const points: MapKitLatLng[] = []
  const push = (candidate: unknown): void => {
    if (!Array.isArray(candidate) || candidate.length < 2) return
    const [lng, lat] = candidate as [unknown, unknown]
    if (typeof lat !== 'number' || typeof lng !== 'number') return
    points.push({ lat, lng })
  }

  const coordinates = geometry.coordinates
  if (!Array.isArray(coordinates)) return points

  if (geometry.type === 'LineString') {
    for (const point of coordinates) push(point)
    return points
  }
  if (geometry.type === 'Polygon') {
    const outer = coordinates[0]
    if (Array.isArray(outer)) for (const point of outer) push(point)
    return points
  }
  if (geometry.type === 'MultiPolygon') {
    for (const polygon of coordinates) {
      if (!Array.isArray(polygon)) continue
      const outer = polygon[0]
      if (Array.isArray(outer)) for (const point of outer) push(point)
    }
  }
  return points
}
