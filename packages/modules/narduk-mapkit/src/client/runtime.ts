import {
  computeMapKitRegionForLngLatBounds,
  computeMapKitRegionForPoints,
  normalizeMapKitPoint,
  normalizeMapKitSpan,
} from '../geometry/geometry.js'
import { defaultMapKitFrameScheduler } from './timers.js'

import type {
  MapKitLngLatBounds,
  MapKitPointLike,
  MapKitRegionOptions,
} from '../geometry/geometry.js'
import type { MapKitRegion, MapKitRegionSpan } from '../types.js'

type Constructor<TArgs extends readonly unknown[], TResult> = new (...args: TArgs) => TResult

export interface MapKitRegionConstructors<
  TCoordinate = unknown,
  TSpan = unknown,
  TRegion = unknown,
> {
  Coordinate: Constructor<[latitude: number, longitude: number], TCoordinate>
  CoordinateRegion: Constructor<[center: TCoordinate, span: TSpan], TRegion>
  CoordinateSpan: Constructor<[latitudeDelta: number, longitudeDelta: number], TSpan>
}

// Parameter order confirmed empirically against real MapKit JS (not just docs) on
// 2026-07-08: passing a labeled (x, y, scale, z) function and inspecting the actual
// argument values received showed the zoom level arrives in the 3rd position and
// the scale factor arrives in the 4th -- i.e. the real call is (x, y, z, scale).
// Getting this wrong silently breaks any per-tile logic that reads z (e.g. bounds
// gating), since z=1 (near-whole-earth) gets read instead of the real zoom.
export type MapKitTileOverlayUrlTemplate =
  string | ((x: number, y: number, z: number, scale: number) => string)

export type MapKitTileImageSource =
  HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas

export type MapKitTileOverlayImageSource<TImageSource = MapKitTileImageSource> = (
  x: number,
  y: number,
  z: number,
  scale: number,
  data?: unknown,
) => Promise<TImageSource | null>

export type MapKitTileOverlaySource<TImageSource = MapKitTileImageSource> =
  MapKitTileOverlayUrlTemplate | MapKitTileOverlayImageSource<TImageSource>

export interface MapKitTileOverlayConstructors<
  TTileOverlay = unknown,
  TSource extends MapKitTileOverlaySource<unknown> = MapKitTileOverlaySource,
> {
  TileOverlay: Constructor<[source: TSource, options?: MapKitTileOverlayOptions], TTileOverlay>
}

export interface MapKitTileOverlayOptions {
  data?: unknown
  maximumZ?: number
  minimumZ?: number
  opacity?: number
  [key: string]: unknown
}

export interface MapKitOpacityTarget {
  opacity: number
}

export interface MapKitOverlayCrossfadeOptions<TOverlay extends MapKitOpacityTarget> {
  cancelAnimationFrame?: (handle: number) => void
  durationMs?: number
  easing?: (progress: number) => number
  nextOverlay: TOverlay
  now?: () => number
  oldOverlays: readonly TOverlay[]
  onDone?: () => void
  removeOverlay?: (overlay: TOverlay) => void
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
  signal?: AbortSignal
  targetOpacity: number
}

export interface MapKitOverlayCrossfadeController {
  cancel: () => void
  finished: Promise<void>
}

function requireMapKitPoint(point: MapKitPointLike): { lat: number; lng: number } {
  const normalized = normalizeMapKitPoint(point)
  if (!normalized) throw new RangeError('point must contain finite lat and lng values')
  return normalized
}

function requireMapKitSpan(span: MapKitRegionSpan): MapKitRegionSpan {
  const normalized = normalizeMapKitSpan(span)
  if (!normalized) {
    throw new RangeError('span must contain finite latDelta and lngDelta values')
  }
  return normalized
}

function requireMapKitRegion(region: MapKitRegion | null | undefined): MapKitRegion {
  if (!region) throw new RangeError('region is required')
  const center = requireMapKitPoint(region.center)
  const span = requireMapKitSpan(region.span)
  return { center, span }
}

export function createMapKitCoordinate<TCoordinate>(
  mapkit: Pick<MapKitRegionConstructors<TCoordinate>, 'Coordinate'>,
  point: MapKitPointLike,
): TCoordinate {
  const normalized = requireMapKitPoint(point)
  return new mapkit.Coordinate(normalized.lat, normalized.lng)
}

export function createMapKitCoordinateSpan<TSpan>(
  mapkit: Pick<MapKitRegionConstructors<unknown, TSpan>, 'CoordinateSpan'>,
  span: MapKitRegionSpan,
): TSpan {
  const normalized = requireMapKitSpan(span)
  return new mapkit.CoordinateSpan(normalized.latDelta, normalized.lngDelta)
}

export function createMapKitCoordinateRegion<TCoordinate, TSpan, TRegion>(
  mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>,
  region: MapKitRegion,
): TRegion {
  const normalized = requireMapKitRegion(region)
  const center = createMapKitCoordinate(mapkit, normalized.center)
  const span = createMapKitCoordinateSpan(mapkit, normalized.span)
  return new mapkit.CoordinateRegion(center, span)
}

export function createMapKitRegionForPoints<TCoordinate, TSpan, TRegion>(
  mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>,
  points: readonly MapKitPointLike[] | null | undefined,
  options: MapKitRegionOptions = {},
): TRegion | null {
  const region = computeMapKitRegionForPoints(points, options)
  return region ? createMapKitCoordinateRegion(mapkit, region) : null
}

export function createMapKitRegionForLngLatBounds<TCoordinate, TSpan, TRegion>(
  mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>,
  bounds: MapKitLngLatBounds | null | undefined,
  options: MapKitRegionOptions = {},
): TRegion | null {
  const region = computeMapKitRegionForLngLatBounds(bounds, options)
  return region ? createMapKitCoordinateRegion(mapkit, region) : null
}

export function createMapKitTileOverlay<
  TTileOverlay,
  TSource extends MapKitTileOverlaySource<unknown>,
>(
  mapkit: MapKitTileOverlayConstructors<TTileOverlay, TSource>,
  source: TSource,
  options: MapKitTileOverlayOptions = {},
): TTileOverlay {
  if (typeof source === 'string' && !source.trim())
    throw new Error('tile overlay source is required')
  if (typeof source !== 'string' && typeof source !== 'function') {
    throw new Error('tile overlay source is required')
  }
  return new mapkit.TileOverlay(source, options)
}

export interface MapKitAsyncTileOverlayLifecycle {
  onError?: (reason: unknown) => void
  onFirstImage?: () => void
}

/**
 * Construct a MapKit JS 6 Promise<ImageSource> tile overlay and expose the
 * first usable image as a lifecycle event for safe layer replacement.
 */
export function createMapKitAsyncTileOverlay<TTileOverlay, TImageSource>(
  mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlayImageSource<TImageSource>>,
  imageForTile: MapKitTileOverlayImageSource<TImageSource>,
  options: MapKitTileOverlayOptions = {},
  lifecycle: MapKitAsyncTileOverlayLifecycle = {},
): TTileOverlay {
  let hasImage = false
  const source: MapKitTileOverlayImageSource<TImageSource> = (x, y, z, scale, data) => {
    try {
      return imageForTile(x, y, z, scale, data)
        .then((image) => {
          if (image !== null && !hasImage) {
            hasImage = true
            lifecycle.onFirstImage?.()
          }
          return image
        })
        .catch((reason: unknown) => {
          lifecycle.onError?.(reason)
          return null
        })
    } catch (reason) {
      lifecycle.onError?.(reason)
      return Promise.resolve(null)
    }
  }
  return createMapKitTileOverlay(mapkit, source, options)
}

export function uniqueMapKitOverlays<TOverlay>(overlays: readonly TOverlay[]): TOverlay[] {
  return [...new Set(overlays)]
}

export interface MapKitVectorOverlayMap<TOverlay = unknown> {
  overlays?: readonly TOverlay[]
  addOverlay: (overlay: TOverlay) => unknown
  removeOverlay: (overlay: TOverlay) => void
}

const attachedVectorOverlays = new WeakMap<object, Set<unknown>>()

function attachedVectorOverlaySet(map: object): Set<unknown> {
  let overlays = attachedVectorOverlays.get(map)
  if (!overlays) {
    overlays = new Set()
    attachedVectorOverlays.set(map, overlays)
  }
  return overlays
}

/** Add a vector overlay once, even when a reactive visibility update repeats. */
export function addMapKitVectorOverlay<TOverlay>(
  map: MapKitVectorOverlayMap<TOverlay>,
  overlay: TOverlay,
): void {
  const attached = attachedVectorOverlaySet(map)
  if (attached.has(overlay)) return
  if (!map.overlays?.includes(overlay)) map.addOverlay(overlay)
  attached.add(overlay)
}

/** Remove a vector overlay only when MapKit still has it attached. */
export function removeMapKitVectorOverlay<TOverlay>(
  map: MapKitVectorOverlayMap<TOverlay>,
  overlay: TOverlay,
): void {
  const attached = attachedVectorOverlaySet(map)
  const present = attached.has(overlay) || Boolean(map.overlays?.includes(overlay))
  if (!present) return
  map.removeOverlay(overlay)
  attached.delete(overlay)
}

export function easeInOutQuad(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2
}

export function interpolateNumber(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function finiteOpacity(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * The single clock the crossfade reads.
 *
 * `requestAnimationFrame` hands its callback a `performance.now()` timestamp,
 * whose epoch is page load -- not `Date.now()`'s Unix epoch. Measuring
 * `frameTimestamp - Date.now()` therefore produced a large negative number that
 * `Math.max(0, ...)` clamped to `0` on every frame, so progress never advanced
 * and the fade never completed in a real browser. The fix is to read elapsed
 * time from ONE clock: `now()` for both the start stamp and every frame, and to
 * ignore the frame timestamp entirely (narduk-libs#421, spec §d).
 */
function defaultCrossfadeNow(): number {
  const performanceNow = globalThis.performance?.now
  return performanceNow ? performanceNow.call(globalThis.performance) : Date.now()
}

export function crossfadeMapKitOverlayOpacity<TOverlay extends MapKitOpacityTarget>(
  options: MapKitOverlayCrossfadeOptions<TOverlay>,
): MapKitOverlayCrossfadeController {
  const durationMs = Math.max(0, options.durationMs ?? 520)
  const oldOverlays = uniqueMapKitOverlays(options.oldOverlays)
  const oldStartOpacities = oldOverlays.map((overlay) =>
    finiteOpacity(overlay.opacity, options.targetOpacity),
  )
  const nextStartOpacity = finiteOpacity(options.nextOverlay.opacity, 0)
  const easing = options.easing ?? easeInOutQuad
  const now = options.now ?? defaultCrossfadeNow
  const requestFrame =
    options.requestAnimationFrame ?? defaultMapKitFrameScheduler.requestAnimationFrame
  const cancelFrame =
    options.cancelAnimationFrame ?? defaultMapKitFrameScheduler.cancelAnimationFrame
  const start = now()
  let frameHandle: number | null = null
  let settled = false
  let resolveFinished: () => void = () => {}

  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })

  function finish(complete: boolean): void {
    if (settled) return
    settled = true
    if (complete) {
      options.nextOverlay.opacity = options.targetOpacity
      for (const overlay of oldOverlays) {
        options.removeOverlay?.(overlay)
      }
      options.onDone?.()
    }
    resolveFinished()
  }

  function step(): void {
    if (settled) return
    if (options.signal?.aborted) {
      finish(false)
      return
    }

    // The frame timestamp is deliberately unread: it belongs to a different
    // epoch than `now()`. See `defaultCrossfadeNow`.
    const elapsed = Math.max(0, now() - start)
    const progress = durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs)
    const eased = easing(progress)
    options.nextOverlay.opacity = interpolateNumber(nextStartOpacity, options.targetOpacity, eased)
    // `uniqueMapKitOverlays` returns a dense array, so `.entries()` matches
    // the old `forEach` index pairing (narduk-libs#138).
    for (const [index, overlay] of oldOverlays.entries()) {
      overlay.opacity = oldStartOpacities[index]! * (1 - eased)
    }

    if (progress >= 1) {
      finish(true)
      return
    }

    frameHandle = requestFrame(step)
  }

  frameHandle = requestFrame(step)

  return {
    cancel: () => {
      if (frameHandle !== null) cancelFrame(frameHandle)
      finish(false)
    },
    finished,
  }
}
