import { computeMapKitRegionForLngLatBounds } from '../geometry/geometry.js'
import {
  createMapKitCoordinateRegion,
  createMapKitAsyncTileOverlay,
  createMapKitTileOverlay,
  crossfadeMapKitOverlayOpacity,
} from './runtime.js'

import type { MapKitLngLatBounds, MapKitRegionOptions } from '../geometry/geometry.js'
import type {
  MapKitOpacityTarget,
  MapKitTileImageSource,
  MapKitTileOverlayImageSource,
  MapKitTileOverlaySource,
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

interface MapKitLayerDescriptorBase<TData = unknown> {
  bounds?: MapKitLngLatBounds
  data?: TData
  id: string
  maximumZ?: number
  minimumZ?: number
  opacity?: number
}

export interface MapKitUrlLayerDescriptor<TData = unknown>
  extends MapKitLayerDescriptorBase<TData> {
  urlTemplate: string
}

export interface MapKitAsyncLayerDescriptor<
  TData = unknown,
  TImageSource = MapKitTileImageSource,
> extends MapKitLayerDescriptorBase<TData> {
  imageForTile: MapKitTileOverlayImageSource<TImageSource>
  onTileError?: (reason: unknown) => void
}

export type MapKitLayerDescriptor<TData = unknown, TImageSource = MapKitTileImageSource> =
  | MapKitUrlLayerDescriptor<TData>
  | MapKitAsyncLayerDescriptor<TData, TImageSource>

export interface MapKitLayerRegionOptions extends MapKitRegionOptions {}

export interface MapKitLayerMapHandle<TTileOverlay> {
  addTileOverlay(overlay: TTileOverlay): void
  removeTileOverlay(overlay: TTileOverlay): void
}

export interface MapKitLayerRegistryOptions<TTileOverlay> {
  crossfadeDurationMs?: number
  map: MapKitLayerMapHandle<TTileOverlay>
  mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlaySource<unknown>>
}

interface MapKitLayerRegistryEntry<TTileOverlay extends MapKitOpacityTarget> {
  controller?: MapKitOverlayCrossfadeController
  /** Last applied descriptor; used by `reconcile()` to skip no-op source swaps. */
  descriptor?: MapKitLayerDescriptor
  fading: Set<TTileOverlay>
  overlay: TTileOverlay
  pending?: { cancel: () => void }
}

export interface MapKitLayerReplaceOptions {
  activateWhen?: 'immediate' | 'first-image'
  crossfadeDurationMs?: number
  readinessTimeoutMs?: number
  signal?: AbortSignal
}

export interface MapKitLayerReconcileOptions {
  /** Crossfade duration for source changes. Use `0` for atomic Safari-safe swaps. */
  crossfadeDurationMs?: number
  signal?: AbortSignal
}

/**
 * Stable identity for the tile source of a layer descriptor, excluding opacity.
 * Used by `MapKitLayerRegistry.reconcile()` to decide setOpacity vs replace.
 */
export function layerSourceIdentity(descriptor: MapKitLayerDescriptor): string {
  if ('imageForTile' in descriptor) {
    return [
      'async',
      descriptor.id,
      JSON.stringify(descriptor.data ?? null),
      String(descriptor.minimumZ ?? ''),
      String(descriptor.maximumZ ?? ''),
    ].join('|')
  }
  return [
    'url',
    descriptor.id,
    descriptor.urlTemplate,
    JSON.stringify(descriptor.bounds ?? null),
    String(descriptor.minimumZ ?? ''),
    String(descriptor.maximumZ ?? ''),
    JSON.stringify(descriptor.data ?? null),
  ].join('|')
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

function boundsIntersectTile(
  bounds: MapKitLngLatBounds,
  tile: TileBounds,
  ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
  const [, southLat, , northLat] = bounds
  const south = clamp(Math.min(southLat, northLat), -90, 90)
  const north = clamp(Math.max(southLat, northLat), -90, 90)
  if (!Number.isFinite(south) || !Number.isFinite(north)) return false
  if (south > tile.northLat || north < tile.southLat) return false

  const tileLngRange = [clamp(tile.westLng, -180, 180), clamp(tile.eastLng, -180, 180)] as const
  return ranges.some((range) => rangesIntersect(range, tileLngRange))
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

  const ranges = longitudeRanges(bounds)
  const decisionCache = new Map<string, boolean>()
  const maxDecisionCacheEntries = 2048

  return (x: number, y: number, z: number, scale: number): string => {
    // Scale changes the URL but not geographic intersection. MapKit commonly
    // asks for the same tile at 1x and 2x, so cache only the geometry decision.
    const cacheKey = `${z}/${x}/${y}`
    const cached = decisionCache.get(cacheKey)
    if (cached !== undefined) {
      return cached ? formatUrlTemplate(urlTemplate, x, y, scale, z) : TRANSPARENT_PNG_DATA_URI
    }

    const tile = tileLngLatBounds(x, y, z)
    const intersects = Boolean(tile && boundsIntersectTile(bounds, tile, ranges))
    if (decisionCache.size >= maxDecisionCacheEntries) {
      const oldestKey = decisionCache.keys().next().value
      if (oldestKey) decisionCache.delete(oldestKey)
    }
    decisionCache.set(cacheKey, intersects)
    if (!intersects) return TRANSPARENT_PNG_DATA_URI
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
  readonly #mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlaySource<unknown>>

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
      descriptor,
      fading: new Set(),
      overlay,
    })
    return overlay
  }

  unregister(id: string): void {
    const entry = this.#entries.get(id)
    if (!entry) return

    entry.controller?.cancel()
    entry.pending?.cancel()
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
    options: MapKitLayerReplaceOptions = {},
  ): Promise<void> {
    requireLayerId(id)
    if (descriptor.id !== id) throw new Error('replacement descriptor id must match id')
    const entry = this.#entries.get(id)
    if (!entry) throw new Error(`layer "${id}" is not registered`)

    entry.controller?.cancel()
    entry.pending?.cancel()
    const oldOverlays = uniqueOverlays([entry.overlay, ...entry.fading])
    for (const overlay of oldOverlays) entry.fading.add(overlay)

    const targetOpacity = descriptor.opacity ?? 1
    const crossfadeDurationMs = options.crossfadeDurationMs ?? this.#defaultCrossfadeDurationMs
    // MapKit JS does not consistently repaint a TileOverlay after mutating its
    // opacity in Safari. For an atomic replacement, construct the incoming
    // overlay at its final opacity and use readiness only to decide when the
    // previous overlay can be retired.
    const replaceAtomically = crossfadeDurationMs === 0
    let markReady: () => void = () => {}
    const ready = new Promise<void>((resolve) => { markReady = resolve })
    const nextOverlay = this.#createOverlay(descriptor, replaceAtomically ? targetOpacity : 0, markReady)
    this.#map.addTileOverlay(nextOverlay)
    entry.overlay = nextOverlay
    entry.descriptor = descriptor

    let cancelPending: () => void = () => {}
    const cancelled = new Promise<'cancel'>((resolve) => {
      cancelPending = () => resolve('cancel')
    })
    entry.pending = { cancel: cancelPending }

    const activate = async (): Promise<void> => {
      if (options.activateWhen === 'first-image' && 'imageForTile' in descriptor) {
        const timeoutMs = Math.max(0, options.readinessTimeoutMs ?? 1500)
        const timeout = new Promise<'timeout'>((resolve) => {
          globalThis.setTimeout(() => resolve('timeout'), timeoutMs)
        })
        const signal = options.signal
        const aborted = new Promise<'abort'>((resolve) => {
          if (signal?.aborted) resolve('abort')
          else signal?.addEventListener('abort', () => resolve('abort'), { once: true })
        })
        const outcome = await Promise.race([
          ready.then(() => 'ready' as const),
          timeout,
          cancelled,
          aborted,
        ])
        if (outcome === 'cancel' || outcome === 'abort') return
      }

      if (entry.overlay !== nextOverlay) return
      if (entry.pending?.cancel === cancelPending) delete entry.pending

      if (replaceAtomically) {
        for (const overlay of oldOverlays) {
          this.#map.removeTileOverlay(overlay)
          entry.fading.delete(overlay)
        }
        return
      }

      let controller: MapKitOverlayCrossfadeController
      const crossfadeOptions: MapKitOverlayCrossfadeOptions<TTileOverlay> = {
        durationMs: crossfadeDurationMs,
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
      await controller.finished
    }
    return activate()
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

  /**
   * Sync the registry to exactly `descriptors` (order preserved for listing only).
   *
   * Designed for multi-dataset stacks where several tile overlays share a map
   * with independent opacity and may change dated URL templates over time:
   * - new ids → `register`
   * - removed ids → `unregister`
   * - same id + same source identity → `setOpacity` only
   * - same id + changed source → `replace` (atomic when crossfade is 0)
   *
   * Source identity is derived from urlTemplate/bounds/z-range (or `data` for
   * async image overlays), not from opacity.
   */
  async reconcile(
    descriptors: readonly MapKitLayerDescriptor[],
    options: MapKitLayerReconcileOptions = {},
  ): Promise<void> {
    const desiredIds = new Set<string>()
    for (const descriptor of descriptors) {
      requireLayerId(descriptor.id)
      if (desiredIds.has(descriptor.id)) {
        throw new Error(`duplicate layer id "${descriptor.id}" in reconcile()`)
      }
      desiredIds.add(descriptor.id)
    }

    for (const id of [...this.#entries.keys()]) {
      if (!desiredIds.has(id)) this.unregister(id)
    }

    const crossfadeDurationMs =
      options.crossfadeDurationMs ?? this.#defaultCrossfadeDurationMs
    const replacements: Promise<void>[] = []

    for (const descriptor of descriptors) {
      const entry = this.#entries.get(descriptor.id)
      const opacity = descriptor.opacity ?? 1
      if (!entry) {
        this.register(descriptor)
        continue
      }

      const previous = entry.descriptor
      if (previous && layerSourceIdentity(previous) === layerSourceIdentity(descriptor)) {
        this.setOpacity(descriptor.id, opacity)
        entry.descriptor = descriptor
        continue
      }

      replacements.push(
        this.replace(descriptor.id, descriptor, {
          crossfadeDurationMs,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        }).then(() => {
          const current = this.#entries.get(descriptor.id)
          if (current) current.descriptor = descriptor
        }),
      )
    }

    await Promise.all(replacements)
  }

  #createOverlay(
    descriptor: MapKitLayerDescriptor,
    opacity: number,
    onFirstImage?: () => void,
  ): TTileOverlay {
    if ('imageForTile' in descriptor) {
      const lifecycle: { onError?: (reason: unknown) => void; onFirstImage?: () => void } = {}
      if (descriptor.onTileError) lifecycle.onError = descriptor.onTileError
      if (onFirstImage) lifecycle.onFirstImage = onFirstImage
      return createMapKitAsyncTileOverlay(
        this.#mapkit,
        descriptor.imageForTile,
        overlayOptionsForDescriptor(descriptor, opacity),
        lifecycle,
      )
    }
    const urlTemplate = createBoundsGatedUrlTemplate(descriptor.urlTemplate, descriptor.bounds)
    return createMapKitTileOverlay(
      this.#mapkit,
      urlTemplate,
      overlayOptionsForDescriptor(descriptor, opacity),
    )
  }
}
