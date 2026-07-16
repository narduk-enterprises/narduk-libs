import {
  MapKitLayerRegistry,
  createBoundsGatedUrlTemplate,
  regionForMapKitLayer,
  regionForMapKitLayerBounds,
} from '../src/client/index.js'
import { computeMapKitRegionForLngLatBounds } from '../src/geometry/index.js'

import type {
  MapKitTileOverlaySource,
  MapKitTileOverlayUrlTemplate,
} from '../src/client/index.js'

describe('MapKit layer helpers', () => {
  class Coordinate {
    constructor(
      readonly latitude: number,
      readonly longitude: number,
    ) {}
  }

  class CoordinateSpan {
    constructor(
      readonly latitudeDelta: number,
      readonly longitudeDelta: number,
    ) {}
  }

  class CoordinateRegion {
    constructor(
      readonly center: Coordinate,
      readonly span: CoordinateSpan,
    ) {}
  }

  class TileOverlay {
    readonly opacity: number

    constructor(
      readonly urlTemplate: MapKitTileOverlaySource<unknown>,
      readonly options: Record<string, unknown> = {},
    ) {
      this.opacity = typeof options.opacity === 'number' ? options.opacity : 1
    }
  }

  const mapkit = {
    Coordinate,
    CoordinateRegion,
    CoordinateSpan,
    TileOverlay,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the original template when bounds are absent', () => {
    expect(createBoundsGatedUrlTemplate('/tiles/{z}/{x}/{y}.png', undefined)).toBe(
      '/tiles/{z}/{x}/{y}.png',
    )
  })

  it('returns real tile URLs inside bounds and a transparent PNG outside bounds', () => {
    const urlTemplate = createBoundsGatedUrlTemplate('/tiles/{z}/{x}/{y}@{scale}x.png', [
      -100,
      20,
      -90,
      30,
    ])

    expect(typeof urlTemplate).toBe('function')
    const resolveTileUrl = urlTemplate as Exclude<MapKitTileOverlayUrlTemplate, string>

    // Real MapKit JS invokes urlTemplate functions as (x, y, z, scale) -- confirmed
    // empirically against the live SDK on 2026-07-08, not just from docs.
    expect(resolveTileUrl(0, 0, 1, 2)).toBe('/tiles/1/0/0@2x.png')
    expect(resolveTileUrl(1, 1, 1, 2)).toMatch(/^data:image\/png;base64,/)
  })

  it('reuses tile intersection decisions across scale variants', () => {
    const resolveTileUrl = createBoundsGatedUrlTemplate(
      '/tiles/{z}/{x}/{y}@{scale}x.png',
      [-100, 20, -90, 30],
    ) as Exclude<MapKitTileOverlayUrlTemplate, string>

    expect(resolveTileUrl(0, 0, 1, 1)).toBe('/tiles/1/0/0@1x.png')
    expect(resolveTileUrl(0, 0, 1, 2)).toBe('/tiles/1/0/0@2x.png')
    expect(resolveTileUrl(1, 1, 1, 1)).toMatch(/^data:image\/png;base64,/)
    expect(resolveTileUrl(1, 1, 1, 2)).toMatch(/^data:image\/png;base64,/)
  })

  it('tightens the default minimum span for small AOI layer bounds', () => {
    const bounds = [-97.701, 30.201, -97.699, 30.203] as const
    const untightened = computeMapKitRegionForLngLatBounds(bounds)
    const tightened = regionForMapKitLayerBounds(mapkit, bounds)

    expect(untightened?.span.latDelta).toBe(0.01)
    expect(tightened.span.latitudeDelta).toBeLessThan(0.01)
    expect(tightened.span.longitudeDelta).toBeLessThan(0.01)

    const explicit = regionForMapKitLayerBounds(mapkit, bounds, {
      minSpanDelta: 0.02,
      padding: 0,
    })
    expect(explicit.span.latitudeDelta).toBe(0.02)
    expect(explicit.span.longitudeDelta).toBe(0.02)
  })

  it('creates regions directly from bounded layer descriptors', () => {
    const region = regionForMapKitLayer(mapkit, {
      bounds: [-97.701, 30.201, -97.699, 30.203],
      id: 'farm',
      urlTemplate: '/tiles/farm/{z}/{x}/{y}.png',
    })

    expect(region.center.latitude).toBeCloseTo(30.202)
    expect(() =>
      regionForMapKitLayer(mapkit, {
        id: 'global',
        urlTemplate: '/tiles/global/{z}/{x}/{y}.png',
      }),
    ).toThrow('bounds')
  })
})

describe('MapKitLayerRegistry', () => {
  class TileOverlay {
    opacity: number

    constructor(
      readonly urlTemplate: MapKitTileOverlaySource<unknown>,
      readonly options: Record<string, unknown> = {},
    ) {
      this.opacity = typeof options.opacity === 'number' ? options.opacity : 1
    }
  }

  const mapkit = {
    TileOverlay,
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('registers, unregisters, and sets opacity independently by layer id', () => {
    const added: TileOverlay[] = []
    const removed: TileOverlay[] = []
    const registry = new MapKitLayerRegistry({
      map: {
        addTileOverlay: (overlay) => added.push(overlay),
        removeTileOverlay: (overlay) => removed.push(overlay),
      },
      mapkit,
    })

    const first = registry.register({
      bounds: [-100, 20, -90, 30],
      data: { dataset: 'a' },
      id: 'a',
      maximumZ: 12,
      minimumZ: 4,
      opacity: 0.6,
      urlTemplate: '/tiles/a/{z}/{x}/{y}.png',
    })
    const second = registry.register({
      id: 'b',
      opacity: 0.4,
      urlTemplate: '/tiles/b/{z}/{x}/{y}.png',
    })

    expect(added).toEqual([first, second])
    expect(typeof first.urlTemplate).toBe('function')
    expect(second.urlTemplate).toBe('/tiles/b/{z}/{x}/{y}.png')
    expect(first.options).toMatchObject({
      data: { dataset: 'a' },
      maximumZ: 12,
      minimumZ: 4,
      opacity: 0.6,
    })
    expect(second.opacity).toBe(0.4)
    expect(registry.list()).toEqual(['a', 'b'])

    registry.setOpacity('b', 0.25)
    expect(first.opacity).toBe(0.6)
    expect(second.opacity).toBe(0.25)

    registry.unregister('a')
    registry.unregister('missing')
    expect(removed).toEqual([first])
    expect(registry.has('a')).toBe(false)
    expect(registry.get('b')).toBe(second)
  })

  it('folds pending old overlays into a rapid second replace crossfade', async () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let handle = 0
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        handle += 1
        callbacks.set(handle, callback)
        return handle
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((cancelledHandle: number) => {
        callbacks.delete(cancelledHandle)
      }),
    )

    const added: TileOverlay[] = []
    const removed: TileOverlay[] = []
    const registry = new MapKitLayerRegistry({
      crossfadeDurationMs: 100,
      map: {
        addTileOverlay: (overlay) => added.push(overlay),
        removeTileOverlay: (overlay) => removed.push(overlay),
      },
      mapkit,
    })

    const initial = registry.register({
      id: 'raster',
      opacity: 0.8,
      urlTemplate: '/tiles/a/{z}/{x}/{y}.png',
    })
    const firstReplace = registry.replace('raster', {
      id: 'raster',
      opacity: 0.7,
      urlTemplate: '/tiles/b/{z}/{x}/{y}.png',
    })
    const firstReplacement = registry.get('raster')
    const secondReplace = registry.replace(
      'raster',
      {
        id: 'raster',
        opacity: 0.9,
        urlTemplate: '/tiles/c/{z}/{x}/{y}.png',
      },
      { crossfadeDurationMs: 0 },
    )
    const secondReplacement = registry.get('raster')

    expect(firstReplacement).toBe(added[1])
    expect(secondReplacement).toBe(added[2])
    expect(new Set(removed)).toEqual(new Set([initial, firstReplacement]))
    expect(callbacks.size).toBe(0)

    await Promise.all([firstReplace, secondReplace])

    expect(new Set(removed)).toEqual(new Set([initial, firstReplacement]))
    expect(secondReplacement?.opacity).toBe(0.9)
    expect(registry.get('raster')).toBe(secondReplacement)
  })

  it('retires the old overlay after bounded async-image readiness', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(Date.now())
        return 1
      }),
    )

    const added: TileOverlay[] = []
    const removed: TileOverlay[] = []
    const registry = new MapKitLayerRegistry({
      map: {
        addTileOverlay: (overlay) => added.push(overlay),
        removeTileOverlay: (overlay) => removed.push(overlay),
      },
      mapkit,
    })
    const initial = registry.register({
      id: 'farm',
      urlTemplate: '/tiles/yield/{z}/{x}/{y}.png',
    })
    const replacement = registry.replace(
      'farm',
      {
        id: 'farm',
        imageForTile: () => new Promise<null>(() => {}),
      },
      {
        activateWhen: 'first-image',
        crossfadeDurationMs: 0,
        readinessTimeoutMs: 250,
      },
    )

    expect(added).toHaveLength(2)
    expect(removed).toEqual([])
    expect(added[1]?.opacity).toBe(1)

    await vi.advanceTimersByTimeAsync(250)
    await replacement

    expect(removed).toEqual([initial])
    expect(registry.get('farm')).toBe(added[1])
    expect(added[1]?.opacity).toBe(1)
  })
})
