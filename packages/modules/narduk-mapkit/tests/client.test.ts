import {
  addMapKitVectorOverlay,
  createMapKitAsyncTileOverlay,
  createMapKitCoordinateRegion,
  createMapKitRegionForLngLatBounds,
  createMapKitRegionForPoints,
  createMapKitTileOverlay,
  crossfadeMapKitOverlayOpacity,
  removeMapKitVectorOverlay,
  refreshMapKitMapLayout,
} from '../src/client/index.js'

import type { MapKitTileOverlayUrlTemplate } from '../src/client/index.js'

describe('browser MapKit runtime helpers', () => {
  it('refreshes a map after its host layout changes', () => {
    const region = { center: 'center', span: 'span' }
    const map = { region }

    refreshMapKitMapLayout(map)

    expect(map.region).toBe(region)
  })

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
    constructor(
      readonly urlTemplate: MapKitTileOverlayUrlTemplate,
      readonly options: Record<string, unknown> = {},
    ) {}
  }

  const mapkit = {
    Coordinate,
    CoordinateRegion,
    CoordinateSpan,
    TileOverlay,
  }

  it('creates MapKit coordinate regions from plain package regions', () => {
    const region = createMapKitCoordinateRegion(mapkit, {
      center: { lat: 30.2672, lng: -97.7431 },
      span: { latDelta: 0.1, lngDelta: 0.2 },
    })

    expect(region.center).toBeInstanceOf(Coordinate)
    expect(region.center.latitude).toBe(30.2672)
    expect(region.center.longitude).toBe(-97.7431)
    expect(region.span.latitudeDelta).toBe(0.1)
    expect(region.span.longitudeDelta).toBe(0.2)
  })

  it('creates MapKit regions from points and lng/lat bounds', () => {
    const pointRegion = createMapKitRegionForPoints(mapkit, [
      { lat: 30.2, lng: -97.8 },
      { lat: 30.3, lng: -97.7 },
    ])
    const boundsRegion = createMapKitRegionForLngLatBounds(mapkit, [-180, -70, 180, 70], {
      padding: 0,
    })

    expect(pointRegion?.center.latitude).toBe(30.25)
    expect(boundsRegion?.center.longitude).toBe(0)
    expect(boundsRegion?.span.longitudeDelta).toBe(360)
  })

  it('creates tile overlays from template and options', () => {
    const overlay = createMapKitTileOverlay(mapkit, '/tiles/{z}/{x}/{y}.png', {
      maximumZ: 10,
      minimumZ: 3.33,
      opacity: 0.8,
    })

    expect(overlay.urlTemplate).toBe('/tiles/{z}/{x}/{y}.png')
    expect(overlay.options).toMatchObject({ maximumZ: 10, minimumZ: 3.33, opacity: 0.8 })
  })

  it('reports the first MapKit JS 6 async tile image and contains tile errors', async () => {
    class AsyncTileOverlay {
      constructor(
        readonly imageForTile: (
          x: number,
          y: number,
          z: number,
          scale: number,
        ) => Promise<object | null>,
        readonly options: Record<string, unknown> = {},
      ) {}
    }
    const onFirstImage = vi.fn()
    const onError = vi.fn()
    const images = [
      Promise.resolve({ image: 1 }),
      Promise.resolve({ image: 2 }),
      Promise.reject(new Error('tile')),
    ]
    const overlay = createMapKitAsyncTileOverlay(
      { TileOverlay: AsyncTileOverlay },
      vi.fn(() => images.shift() ?? Promise.resolve(null)),
      { opacity: 0 },
      { onError, onFirstImage },
    )

    await expect(overlay.imageForTile(1, 2, 3, 1)).resolves.toEqual({ image: 1 })
    await expect(overlay.imageForTile(1, 2, 3, 1)).resolves.toEqual({ image: 2 })
    await expect(overlay.imageForTile(1, 2, 3, 1)).resolves.toBeNull()
    expect(onFirstImage).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('makes vector overlay attach and removal idempotent', () => {
    const overlay = {}
    const attached: object[] = []
    const map = {
      overlays: attached,
      addOverlay: vi.fn((value: object) => attached.push(value)),
      removeOverlay: vi.fn((value: object) => attached.splice(attached.indexOf(value), 1)),
    }

    addMapKitVectorOverlay(map, overlay)
    addMapKitVectorOverlay(map, overlay)
    removeMapKitVectorOverlay(map, overlay)
    removeMapKitVectorOverlay(map, overlay)

    expect(map.addOverlay).toHaveBeenCalledTimes(1)
    expect(map.removeOverlay).toHaveBeenCalledTimes(1)
    expect(attached).toEqual([])
  })

  it('crossfades overlay opacity and removes stale overlays', async () => {
    const oldOverlay = { opacity: 0.8 }
    const nextOverlay = { opacity: 0 }
    const removed: Array<{ opacity: number }> = []
    const callbacks: FrameRequestCallback[] = []
    // Progress is read from `now()`, never from the frame timestamp: the two
    // use different epochs in a real browser (narduk-libs#421 §d).
    let clock = 0
    const controller = crossfadeMapKitOverlayOpacity({
      durationMs: 100,
      nextOverlay,
      now: () => clock,
      oldOverlays: [oldOverlay],
      removeOverlay: (overlay) => removed.push(overlay),
      requestAnimationFrame: (callback) => {
        callbacks.push(callback)
        return callbacks.length
      },
      targetOpacity: 1,
    })

    clock = 50
    callbacks.shift()?.(50)
    expect(nextOverlay.opacity).toBeGreaterThan(0)
    expect(oldOverlay.opacity).toBeLessThan(0.8)

    clock = 100
    callbacks.shift()?.(100)
    await controller.finished

    expect(nextOverlay.opacity).toBe(1)
    expect(oldOverlay.opacity).toBe(0)
    expect(removed).toEqual([oldOverlay])
  })

  it('cancels crossfades without completing opacity or removing overlays', async () => {
    const oldOverlay = { opacity: 0.8 }
    const nextOverlay = { opacity: 0 }
    const removed: Array<{ opacity: number }> = []
    const callbacks: FrameRequestCallback[] = []
    const controller = crossfadeMapKitOverlayOpacity({
      durationMs: 100,
      nextOverlay,
      now: () => 0,
      oldOverlays: [oldOverlay],
      removeOverlay: (overlay) => removed.push(overlay),
      requestAnimationFrame: (callback) => {
        callbacks.push(callback)
        return callbacks.length
      },
      targetOpacity: 1,
    })

    controller.cancel()
    callbacks.shift()?.(100)
    await controller.finished

    expect(nextOverlay.opacity).toBe(0)
    expect(oldOverlay.opacity).toBe(0.8)
    expect(removed).toEqual([])
  })
})
