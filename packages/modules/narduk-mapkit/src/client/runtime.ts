import {
  computeMapKitRegionForLngLatBounds,
  computeMapKitRegionForPoints,
  normalizeMapKitPoint,
  normalizeMapKitSpan,
} from '../geometry/geometry.js'

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

export interface MapKitTileOverlayConstructors<TTileOverlay = unknown> {
  TileOverlay: Constructor<[urlTemplate: string, options?: MapKitTileOverlayOptions], TTileOverlay>
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

export function createMapKitTileOverlay<TTileOverlay>(
  mapkit: MapKitTileOverlayConstructors<TTileOverlay>,
  urlTemplate: string,
  options: MapKitTileOverlayOptions = {},
): TTileOverlay {
  if (!urlTemplate.trim()) throw new Error('urlTemplate is required')
  return new mapkit.TileOverlay(urlTemplate, options)
}

export function uniqueMapKitOverlays<TOverlay>(overlays: readonly TOverlay[]): TOverlay[] {
  return [...new Set(overlays)]
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

function defaultRequestAnimationFrame(callback: FrameRequestCallback): number {
  const requestFrame = globalThis.requestAnimationFrame
  if (requestFrame) return requestFrame.call(globalThis, callback)
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number
}

function defaultCancelAnimationFrame(handle: number): void {
  const cancelFrame = globalThis.cancelAnimationFrame
  if (cancelFrame) {
    cancelFrame.call(globalThis, handle)
    return
  }
  globalThis.clearTimeout(handle)
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
  const now = options.now ?? (() => Date.now())
  const requestFrame = options.requestAnimationFrame ?? defaultRequestAnimationFrame
  const cancelFrame = options.cancelAnimationFrame ?? defaultCancelAnimationFrame
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

  function step(timestamp: number): void {
    if (settled) return
    if (options.signal?.aborted) {
      finish(false)
      return
    }

    const elapsed = Math.max(0, timestamp - start)
    const progress = durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs)
    const eased = easing(progress)
    options.nextOverlay.opacity = interpolateNumber(nextStartOpacity, options.targetOpacity, eased)
    oldOverlays.forEach((overlay, index) => {
      overlay.opacity = oldStartOpacities[index]! * (1 - eased)
    })

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
