/**
 * buoys#142: what an embedded map should be looking at.
 *
 * narduk-mapkit frames a map by the bounding box of everything it was given.
 * That is right for a regional set and useless for this catalogue: measured on
 * the live index (1353 stations, `/api/stations`), latitude runs -47.0 to 71.3
 * and longitude runs -179.8 to 180.0, because NDBC's Indian-Ocean and western
 * Pacific DART buoys carry `region: "atlantic-coast"`. The bounding box of that
 * is the globe -- the homepage hero rendered the whole world on desktop, and on
 * a 390x844 phone the aspect fit cropped it to Europe and Africa with 71 of 570
 * pins in view. Production `a6fb2532` showed the same camera.
 *
 * So the app picks the camera and the embeds set it explicitly:
 *
 * 1. Frame the interquartile core (Tukey, k = 1.5) rather than the extremes, so
 *    a handful of mislabelled buoys cannot drag the view off the data. On the
 *    full index that alone moves the centre from 20.0N 0.1E to 36.7N 92.9W.
 * 2. A frame still wider than a third of the planet is not a map of anything,
 *    so show the North America overview instead. Measured core longitude spans:
 *    the full index 173.7 degrees and `atlantic-coast` 208.3 (both fall back),
 *    against `pacific-coast` 79.8, `gulf-of-mexico` 17.5 and `great-lakes` 16.6
 *    (all framed on their own data). Framing the full index on its own core was
 *    the first attempt here, and it put the same world map back on screen.
 *
 * Fixing the region labels upstream would retire rule 2; rule 1 stands on its
 * own as ordinary outlier discipline.
 */

import { normalizeLongitudeDegrees } from '../geometry/longitude.js'

export interface MapCameraPoint {
  lat: number
  lng: number
}

export interface MapCamera {
  center: MapCameraPoint
  span: MapCameraPoint
}

export interface MapCameraOptions {
  /** Smallest span in degrees, so a single point does not zoom to a street. */
  minSpan?: number
  /** Fraction of the framed range added as breathing room. */
  padding?: number
}

/**
 * The default overview. Centred on the geographic middle of the lower 48, wide
 * enough for both coasts and the Gulf; MapKit widens whichever axis the host's
 * aspect ratio needs, which is what carries the Caribbean and Alaska into view
 * on a landscape embed.
 */
export const NORTH_AMERICA_OVERVIEW: MapCamera = {
  center: { lat: 39, lng: -98 },
  span: { lat: 40, lng: 60 },
}

/** Beyond these a frame is not a map of anywhere. */
const UNUSABLE_LAT_SPAN = 80
const UNUSABLE_LNG_SPAN = 120

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

/** The min and max of the values left after a 1.5-IQR outlier trim. */
function coreRange(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const fence = (q3 - q1) * 1.5
  const kept = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence)
  // An empty `kept` is not reachable for a non-empty input -- the quartiles
  // themselves always survive their own fence -- but the fallback keeps this
  // total rather than resting on that argument.
  if (kept.length === 0) return [sorted[0]!, sorted.at(-1)!]
  return [kept[0]!, kept.at(-1)!]
}

/**
 * `lngs` on one continuous number line that starts just after their largest
 * gap, so a set straddling the antimeridian (179, -179) reads 179..181 rather
 * than -179..179. Same largest-gap rule as `computeLongitudeSpan`. A set whose
 * largest gap is already the one across +/-180 comes back unchanged, so a set
 * that does not cross is framed exactly as before.
 */
function unwrapLongitudes(lngs: number[]): number[] {
  const inRange = lngs.map((lng) =>
    lng >= -180 && lng <= 180 ? lng : normalizeLongitudeDegrees(lng),
  )
  const sorted = [...inRange].sort((a, b) => a - b)
  let largestGap = sorted[0]! + 360 - sorted.at(-1)!
  let start: number | undefined
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index]! - sorted[index - 1]!
    if (gap > largestGap) {
      largestGap = gap
      start = sorted[index]!
    }
  }
  if (start === undefined) return inRange
  const seam = start
  return inRange.map((lng) => (lng >= seam ? lng : lng + 360))
}

/**
 * The camera an embed should show for `points`, or `null` when it has none and
 * the kit's own `fallbackCenter` should stand.
 */
export function mapOverviewCamera(
  points: readonly MapCameraPoint[],
  { minSpan = 0.5, padding = 0.25 }: MapCameraOptions = {},
): MapCamera | null {
  const lats = points.map((point) => point.lat).filter((value) => Number.isFinite(value))
  const lngs = points.map((point) => point.lng).filter((value) => Number.isFinite(value))
  if (lats.length === 0 || lngs.length === 0) return null

  const [south, north] = coreRange(lats)
  // Trimmed on the unwrapped line, so a set crossing +/-180 frames its short
  // arc instead of spanning 360 minus it and falling back (#932).
  const [west, east] = coreRange(unwrapLongitudes(lngs))
  if (north - south > UNUSABLE_LAT_SPAN || east - west > UNUSABLE_LNG_SPAN) {
    return NORTH_AMERICA_OVERVIEW
  }
  const middle = (west + east) / 2

  return {
    center: { lat: (south + north) / 2, lng: middle > 180 ? middle - 360 : middle },
    span: {
      lat: Math.max((north - south) * (1 + padding), minSpan),
      lng: Math.max((east - west) * (1 + padding), minSpan),
    },
  }
}
