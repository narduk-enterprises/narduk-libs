/**
 * Standalone MapKit utility helpers for downstream apps.
 *
 * These helpers operate on plain coordinate data (no mapkit global required)
 * and are safe to call in browser code, server utilities, or anywhere coordinate
 * arithmetic is needed before the MapKit SDK loads.
 *
 * MapKit-SDK-dependent helpers (e.g. `CoordinateRegion` construction) are
 * intentionally kept out of this file so it can be imported without a browser
 * context or without MapKit being initialized.
 *
 * These helpers intentionally avoid the MapKit JS runtime so they can run
 * during SSR, local data prep, or tests.
 */

/** A latitude/longitude pair. */
export interface LatLng {
  lat: number
  lng: number
}

/** A bounding box computed from a set of coordinate points. */
export interface CoordinateBounds {
  centerLat: number
  centerLng: number
  /** True when the shortest longitude span crosses ±180°. */
  crossesAntimeridian: boolean
  /** Eastern edge of the shortest longitude span. May be less than westLng. */
  eastLng: number
  /** Total latitude span (degrees, always ≥ minSpanDelta). */
  latDelta: number
  /** Total longitude span (degrees, always ≥ minSpanDelta). */
  lngDelta: number
  maxLat: number
  /** Maximum numeric longitude in the input set. */
  maxLng: number
  minLat: number
  /** Minimum numeric longitude in the input set. */
  minLng: number
  /** Western edge of the shortest longitude span. */
  westLng: number
}

/**
 * Clamp a latitude value to the valid MapKit range [-90, 90].
 *
 * Apple MapKit silently ignores out-of-range coordinates in some contexts and
 * throws in others. Always normalise before passing user-supplied or
 * API-sourced coordinates to MapKit.
 */
export function clampLatitude(lat: number): number {
  return Math.max(-90, Math.min(90, lat))
}

/**
 * Clamp a longitude value to the valid MapKit range [-180, 180].
 */
export function clampLongitude(lng: number): number {
  return Math.max(-180, Math.min(180, lng))
}

/**
 * Return a coordinate with both values clamped to valid MapKit ranges and
 * rounded to 6 decimal places (≈ 0.1 m precision, sufficient for map display).
 */
export function normalizeCoordinate(lat: number, lng: number): LatLng {
  return {
    lat: Math.round(clampLatitude(lat) * 1_000_000) / 1_000_000,
    lng: Math.round(clampLongitude(lng) * 1_000_000) / 1_000_000,
  }
}

/**
 * Return `true` when both values are finite numbers in the valid MapKit
 * coordinate range. Use this to filter API/user input before passing to MapKit.
 */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

function normalizeLongitudeDegrees(lng: number): number {
  const normalized = ((((lng + 180) % 360) + 360) % 360) - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function toPositiveLongitudeDegrees(lng: number): number {
  return ((lng % 360) + 360) % 360
}

function computeLongitudeSpan(longitudes: number[]): {
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

function assertFiniteNonNegativeNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`)
  }
}

function assertFinitePositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`)
  }
}

/**
 * Compute the bounding box that encloses all supplied coordinate points.
 *
 * Returns `null` when the input array is empty or contains no valid
 * coordinates.
 *
 * @param points   Array of `{ lat, lng }` objects.
 * @param padding  Fractional padding added around all sides (default 0.05 = 5%).
 * @param minSpanDelta  Minimum span in degrees so small clusters still show
 *                      geographic context (default 0.01).
 */
export function computeCoordinateBounds(
  points: LatLng[],
  padding = 0.05,
  minSpanDelta = 0.01,
): CoordinateBounds | null {
  assertFiniteNonNegativeNumber(padding, 'padding')
  assertFinitePositiveNumber(minSpanDelta, 'minSpanDelta')

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  const longitudes: number[] = []
  let count = 0

  for (const p of points) {
    if (!isValidCoordinate(p.lat, p.lng)) continue
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
    longitudes.push(p.lng)
    count++
  }

  if (count === 0) return null

  const rawLatDelta = maxLat - minLat
  const longitudeSpan = computeLongitudeSpan(longitudes)

  const latDelta = Math.max(rawLatDelta * (1 + padding), minSpanDelta)
  const lngDelta = Math.max(longitudeSpan.lngDelta * (1 + padding), minSpanDelta)

  return {
    centerLat: (minLat + maxLat) / 2,
    centerLng: longitudeSpan.centerLng,
    crossesAntimeridian: longitudeSpan.crossesAntimeridian,
    eastLng: longitudeSpan.eastLng,
    latDelta,
    lngDelta,
    minLat,
    maxLat,
    minLng,
    maxLng,
    westLng: longitudeSpan.westLng,
  }
}

/**
 * Compute approximate distance in metres between two coordinates using the
 * Haversine formula (spherical earth).
 *
 * Accurate to within ≈ 0.5% for distances up to a few hundred kilometres —
 * sufficient for map zoom decisions and clustering radius calculations.
 */
export function haversineDistanceMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000 // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const aCos =
    sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng
  return 2 * R * Math.atan2(Math.sqrt(aCos), Math.sqrt(1 - aCos))
}

/**
 * Group a flat array of items into spatial clusters using a simple grid-based
 * approach.
 *
 * This is a lightweight alternative to full DBSCAN/KMeans for situations where
 * the MapKit built-in `clusteringIdentifier` prop is not sufficient (e.g. when
 * you need cluster data on the server or before the SDK loads).
 *
 * @param items           Items to cluster. Each must have `lat` and `lng`.
 * @param gridSizeDegrees Grid cell size in degrees (default 0.5 ≈ 55 km).
 */
export function gridCluster<T extends LatLng>(
  items: T[],
  gridSizeDegrees = 0.5,
): Array<{ center: LatLng; count: number; items: T[] }> {
  if (!Number.isFinite(gridSizeDegrees) || gridSizeDegrees <= 0) {
    throw new RangeError('gridSizeDegrees must be a finite positive number')
  }

  const cells = new Map<string, T[]>()

  for (const item of items) {
    if (!isValidCoordinate(item.lat, item.lng)) continue
    const cellLat = Math.floor(item.lat / gridSizeDegrees)
    const cellLng = Math.floor(normalizeLongitudeDegrees(item.lng) / gridSizeDegrees)
    const key = `${cellLat}:${cellLng}`
    const existing = cells.get(key)
    if (existing) {
      existing.push(item)
    } else {
      cells.set(key, [item])
    }
  }

  return Array.from(cells.values()).map((cellItems) => {
    const totalLat = cellItems.reduce((s, i) => s + i.lat, 0)
    const longitudeSpan = computeLongitudeSpan(cellItems.map((item) => item.lng))
    return {
      center: {
        lat: totalLat / cellItems.length,
        lng: longitudeSpan.centerLng,
      },
      count: cellItems.length,
      items: cellItems,
    }
  })
}
