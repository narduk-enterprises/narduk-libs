import { computeMapKitRegionForLngLatBounds } from '../geometry/geometry.js'
import {
  createMapKitCoordinateRegion,
  createMapKitTileOverlay,
  crossfadeMapKitOverlayOpacity,
} from './runtime.js'

import type { MapKitLngLatBounds, MapKitRegionOptions } from '../geometry/geometry.js'
import type {
  MapKitOpacityTarget,
  MapKitOverlayCrossfadeOptions,
  MapKitOverlayCrossfadeController,
  MapKitRegionConstructors,
  MapKitTileOverlayConstructors,
  MapKitTileOverlayOptions,
  MapKitTileOverlayUrlTemplate,
} from './runtime.js'

const TRANSPARENT_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='
const DEFAULT_REGION_PADDING = 0.05
const DEFAULT_REGION_MIN_SPAN_DELTA = 0.01
const DEFAULT_REPLACE_CROSSFADE_DURATION_MS = 400

export interface MapKitLayerDescriptor<TData = unknown> {
  bounds?: MapKitLngLatBounds
  data?: TData
  id: string
  maximumZ?: number
  minimumZ?: number
  opacity?: number
  urlTemplate: string
}

export interface MapKitLayerRegionOptions extends MapKitRegionOptions {}

export interface MapKitLayerMapHandle<TTileOverlay> {
  addTileOverlay(overlay: TTileOverlay): void
  removeTileOverlay(overlay: TTileOverlay): void
}

export interface MapKitLayerRegistryOptions<TTileOverlay> {
  crossfadeDurationMs?: number
  map: MapKitLayerMapHandle<TTileOverlay>
  mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlayUrlTemplate>
}

interface MapKitLayerRegistryEntry<TTileOverlay extends MapKitOpacityTarget> {
  controller?: MapKitOverlayCrossfadeController
  fading: Set<TTileOverlay>
  overlay: TTileOverlay
}

interface TileBounds {
  eastLng: number
  northLat: number
  southLat: number
  westLng: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeLongitudeDegrees(lng: number): number {
  const normalized = ((((lng + 180) % 360) + 360) % 360) - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function normalizeLongitudeForRange(lng: number): number {
  const normalized = normalizeLongitudeDegrees(lng)
  return normalized === -180 && lng > 0 ? 180 : normalized
}

function tileYToLatitude(y: number, tileCount: number): number {
  const mercator = Math.PI * (1 - (2 * y) / tileCount)
  return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI
}

function tileLngLatBounds(x: number, y: number, z: number): TileBounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  const tileCount = 2 ** z
  if (!Number.isFinite(tileCount) || tileCount <= 0) return null

  const westLng = (x / tileCount) * 360 - 180
  const eastLng = ((x + 1) / tileCount) * 360 - 180
  const northLat = tileYToLatitude(y, tileCount)
  const southLat = tileYToLatitude(y + 1, tileCount)
  if (
    !Number.isFinite(westLng) ||
    !Number.isFinite(eastLng) ||
    !Number.isFinite(northLat) ||
    !Number.isFinite(southLat)
  ) {
    return null
  }

  return {
    eastLng,
    northLat,
    southLat,
    westLng,
  }
}

function longitudeRanges(bounds: MapKitLngLatBounds): ReadonlyArray<readonly [number, number]> {
  const [westLng, , eastLng] = bounds
  const rawLngDelta = eastLng - westLng
  if (!Number.isFinite(rawLngDelta) || Math.abs(rawLngDelta) >= 360) return [[-180, 180]]

  const west = normalizeLongitudeForRange(westLng)
  const east = normalizeLongitudeForRange(eastLng)
  return rawLngDelta >= 0 ? [[west, east]] : [[west, 180], [-180, east]]
}

function rangesIntersect(
  first: readonly [number, number],
  second: readonly [number, number],
): boolean {
  return first[0] <= second[1] && first[1] >= second[0]
}

function boundsIntersectTile(bounds: MapKitLngLatBounds, tile: TileBounds): boolean {
  const [, southLat, , northLat] = bounds
  const south = clamp(Math.min(southLat, northLat), -90, 90)
  const north = clamp(Math.max(southLat, northLat), -90, 90)
  if (!Number.isFinite(south) || !Number.isFinite(north)) return false
  if (south > tile.northLat || north < tile.southLat) return false

  const tileLngRange = [clamp(tile.westLng, -180, 180), clamp(tile.eastLng, -180, 180)] as const
  return longitudeRanges(bounds).some((range) => rangesIntersect(range, tileLngRange))
}

function formatUrlTemplate(
  urlTemplate: string,
  x: number,
  y: number,
  scale: number,
  z: number,
): string {
  return urlTemplate
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
    .replaceAll('{z}', String(z))
    .replaceAll('{scale}', String(scale))
}

function rawBoundsSpan(bounds: MapKitLngLatBounds): number {
  const [westLng, southLat, eastLng, northLat] = bounds
  const rawLngDelta = eastLng - westLng
  const lngSpan =
    Math.abs(rawLngDelta) >= 360 ? 360 : rawLngDelta >= 0 ? rawLngDelta : rawLngDelta + 360
  return Math.max(Math.abs(northLat - southLat), lngSpan)
}

function resolveLayerRegionOptions(
  bounds: MapKitLngLatBounds,
  options: MapKitLayerRegionOptions = {},
): MapKitRegionOptions {
  const resolved: MapKitRegionOptions = { ...options }
  if (!('padding' in resolved)) resolved.padding = DEFAULT_REGION_PADDING
  if (!('minSpanDelta' in resolved)) {
    resolved.minSpanDelta = Math.min(DEFAULT_REGION_MIN_SPAN_DELTA, rawBoundsSpan(bounds) * 0.1)
  }
  return resolved
}

function overlayOptionsForDescriptor(
  descriptor: MapKitLayerDescriptor,
  opacity: number,
): MapKitTileOverlayOptions {
  const options: MapKitTileOverlayOptions = { opacity }
  if (descriptor.minimumZ !== undefined) options.minimumZ = descriptor.minimumZ
  if (descriptor.maximumZ !== undefined) options.maximumZ = descriptor.maximumZ
  if (descriptor.data !== undefined) options.data = descriptor.data
  return options
}

function requireLayerId(id: string): void {
  if (!id.trim()) throw new Error('layer id is required')
}

function uniqueOverlays<TOverlay>(overlays: Iterable<TOverlay>): TOverlay[] {
  return [...new Set(overlays)]
}

export function createBoundsGatedUrlTemplate(
  urlTemplate: string,
  bounds: MapKitLngLatBounds | undefined,
): MapKitTileOverlayUrlTemplate {
  if (!bounds) return urlTemplate
  if (!urlTemplate.trim()) throw new Error('urlTemplate is required')

  return (x: number, y: number, z: number, scale: number): string => {
    const tile = tileLngLatBounds(x, y, z)
    if (!tile || !boundsIntersectTile(bounds, tile)) return TRANSPARENT_PNG_DATA_URI
    return formatUrlTemplate(urlTemplate, x, y, scale, z)
  }
}

export function regionForMapKitLayerBounds<TCoordinate, TSpan, TRegion>(
  mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>,
  bounds: MapKitLngLatBounds,
  options: MapKitLayerRegionOptions = {},
): TRegion {
  const region = computeMapKitRegionForLngLatBounds(bounds, resolveLayerRegionOptions(bounds, options))
  if (!region) throw new RangeError('layer bounds must contain finite lng/lat values')
  return createMapKitCoordinateRegion(mapkit, region)
}

export function regionForMapKitLayer<TCoordinate, TSpan, TRegion>(
  mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>,
  descriptor: MapKitLayerDescriptor,
  options: MapKitLayerRegionOptions = {},
): TRegion {
  if (!descriptor.bounds) throw new Error('layer descriptor must include bounds')
  return regionForMapKitLayerBounds(mapkit, descriptor.bounds, options)
}

export class MapKitLayerRegistry<TTileOverlay extends MapKitOpacityTarget> {
  readonly #defaultCrossfadeDurationMs: number
  readonly #entries = new Map<string, MapKitLayerRegistryEntry<TTileOverlay>>()
  readonly #map: MapKitLayerMapHandle<TTileOverlay>
  readonly #mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlayUrlTemplate>

  constructor(options: MapKitLayerRegistryOptions<TTileOverlay>) {
    this.#mapkit = options.mapkit
    this.#map = options.map
    this.#defaultCrossfadeDurationMs =
      options.crossfadeDurationMs ?? DEFAULT_REPLACE_CROSSFADE_DURATION_MS
  }

  register(descriptor: MapKitLayerDescriptor): TTileOverlay {
    requireLayerId(descriptor.id)
    if (this.#entries.has(descriptor.id)) {
      throw new Error(`layer "${descriptor.id}" is already registered`)
    }

    const overlay = this.#createOverlay(descriptor, descriptor.opacity ?? 1)
    this.#map.addTileOverlay(overlay)
    this.#entries.set(descriptor.id, {
      fading: new Set(),
      overlay,
    })
    return overlay
  }

  unregister(id: string): void {
    const entry = this.#entries.get(id)
    if (!entry) return

    entry.controller?.cancel()
    for (const overlay of uniqueOverlays([entry.overlay, ...entry.fading])) {
      this.#map.removeTileOverlay(overlay)
    }
    this.#entries.delete(id)
  }

  setOpacity(id: string, opacity: number): void {
    const entry = this.#entries.get(id)
    if (!entry) throw new Error(`layer "${id}" is not registered`)
    entry.overlay.opacity = opacity
  }

  replace(
    id: string,
    descriptor: MapKitLayerDescriptor,
    options: { crossfadeDurationMs?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    requireLayerId(id)
    if (descriptor.id !== id) throw new Error('replacement descriptor id must match id')
    const entry = this.#entries.get(id)
    if (!entry) throw new Error(`layer "${id}" is not registered`)

    entry.controller?.cancel()
    const oldOverlays = uniqueOverlays([entry.overlay, ...entry.fading])
    for (const overlay of oldOverlays) entry.fading.add(overlay)

    const targetOpacity = descriptor.opacity ?? 1
    const nextOverlay = this.#createOverlay(descriptor, 0)
    this.#map.addTileOverlay(nextOverlay)
    entry.overlay = nextOverlay

    let controller: MapKitOverlayCrossfadeController
    const crossfadeOptions: MapKitOverlayCrossfadeOptions<TTileOverlay> = {
      durationMs: options.crossfadeDurationMs ?? this.#defaultCrossfadeDurationMs,
      nextOverlay,
      oldOverlays,
      onDone: () => {
        for (const overlay of oldOverlays) entry.fading.delete(overlay)
        if (entry.controller === controller) delete entry.controller
      },
      removeOverlay: (overlay) => this.#map.removeTileOverlay(overlay),
      targetOpacity,
    }
    if (options.signal !== undefined) crossfadeOptions.signal = options.signal

    controller = crossfadeMapKitOverlayOpacity(crossfadeOptions)
    entry.controller = controller
    return controller.finished
  }

  get(id: string): TTileOverlay | undefined {
    return this.#entries.get(id)?.overlay
  }

  has(id: string): boolean {
    return this.#entries.has(id)
  }

  list(): readonly string[] {
    return [...this.#entries.keys()]
  }

  #createOverlay(descriptor: MapKitLayerDescriptor, opacity: number): TTileOverlay {
    const urlTemplate = createBoundsGatedUrlTemplate(descriptor.urlTemplate, descriptor.bounds)
    return createMapKitTileOverlay(
      this.#mapkit,
      urlTemplate,
      overlayOptionsForDescriptor(descriptor, opacity),
    )
  }
}
