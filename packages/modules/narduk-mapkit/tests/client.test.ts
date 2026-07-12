import {
  createMapKitCoordinateRegion,
  createMapKitRegionForLngLatBounds,
  createMapKitRegionForPoints,
  createMapKitTileOverlay,
  crossfadeMapKitOverlayOpacity,
  initializeMapKit,
  refreshMapKitMapLayout,
  resetMapKitClientStateForTests,
} from '../src/client/index.js'

import type { MapKitTileOverlayUrlTemplate } from '../src/client/index.js'

function tokenWithExp(exp: number): string {
  const payload = btoa(JSON.stringify({ exp })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.sig`
}

describe('browser MapKit initialization', () => {
  afterEach(() => {
    resetMapKitClientStateForTests()
  })

  it('loads a dynamic token and registers mapkit authorization callback', async () => {
    const issuedTokens: string[] = []
    const mapkit = {
      init: vi.fn((options: { authorizationCallback(done: (token: string) => void): void }) => {
        options.authorizationCallback((token) => issuedTokens.push(token))
      }),
    }
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 3600)

    await initializeMapKit({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token }))),
      mapkitGlobal: mapkit,
      tokenEndpoint: '/mapkit-token',
    })

    expect(mapkit.init).toHaveBeenCalledTimes(1)
    expect(issuedTokens).toEqual([token])
  })

  it('rejects mismatched singleton initialization options', async () => {
    const mapkit = {
      init: vi.fn((options: { authorizationCallback(done: (token: string) => void): void }) => {
        options.authorizationCallback(() => {})
      }),
    }
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 3600)

    await initializeMapKit({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token }))),
      mapkitGlobal: mapkit,
      tokenEndpoint: '/mapkit-token-a',
    })

    await expect(
      initializeMapKit({
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token }))),
        mapkitGlobal: mapkit,
        tokenEndpoint: '/mapkit-token-b',
      }),
    ).rejects.toThrow('different options')
  })

  it('clears failed initialization so callers can retry', async () => {
    const mapkit = {
      init: vi.fn((options: { authorizationCallback(done: (token: string) => void): void }) => {
        options.authorizationCallback(() => {})
      }),
    }
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 3600)

    await expect(
      initializeMapKit({
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'no token' }), { status: 503 })),
        mapkitGlobal: mapkit,
        tokenEndpoint: '/mapkit-token',
      }),
    ).rejects.toThrow('no token')

    await expect(
      initializeMapKit({
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token }))),
        mapkitGlobal: mapkit,
        tokenEndpoint: '/mapkit-token',
      }),
    ).resolves.toBe(mapkit)
  })
})

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

  it('crossfades overlay opacity and removes stale overlays', async () => {
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

    callbacks.shift()?.(50)
    expect(nextOverlay.opacity).toBeGreaterThan(0)
    expect(oldOverlay.opacity).toBeLessThan(0.8)

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
