import {
  createMapKitRegionForLngLatBounds,
  createMapKitTileOverlay,
  crossfadeMapKitOverlayOpacity,
  initializeMapKit,
} from '@narduk-enterprises/narduk-mapkit/client'

interface MapKitNamespace {
  Coordinate: new (latitude: number, longitude: number) => unknown
  CoordinateRegion: new (center: unknown, span: unknown) => unknown
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => unknown
  Map: new (
    container: HTMLElement,
    options?: Record<string, unknown>,
  ) => {
    addTileOverlay(overlay: TileOverlay): void
    region?: unknown
    removeTileOverlay(overlay: TileOverlay): void
  }
  TileOverlay: new (urlTemplate: string, options?: Record<string, unknown>) => TileOverlay
}

interface TileOverlay {
  opacity: number
}

declare global {
  interface Window {
    mapkit?: MapKitNamespace
  }
}

export async function mountAnimatedTileMap(container: HTMLElement) {
  await initializeMapKit({ tokenEndpoint: '/api/mapkit-token' })
  const mapkit = window.mapkit
  if (!mapkit) throw new Error('MapKit JS did not expose window.mapkit')

  const map = new mapkit.Map(container, { isRotationEnabled: false })
  const region = createMapKitRegionForLngLatBounds(mapkit, [-180, -70, 180, 70], {
    padding: 0,
  })
  if (region) map.region = region

  let currentOverlay: TileOverlay | null = null

  function setFrame(urlTemplate: string, opacity = 0.82): void {
    const nextOverlay = createMapKitTileOverlay(mapkit, urlTemplate, {
      maximumZ: 10,
      minimumZ: 3.33,
      opacity: currentOverlay ? 0 : opacity,
    })
    map.addTileOverlay(nextOverlay)

    if (!currentOverlay) {
      currentOverlay = nextOverlay
      return
    }

    const oldOverlay = currentOverlay
    currentOverlay = nextOverlay
    void crossfadeMapKitOverlayOpacity({
      durationMs: 520,
      nextOverlay,
      oldOverlays: [oldOverlay],
      removeOverlay: (overlay) => map.removeTileOverlay(overlay),
      targetOpacity: opacity,
    }).finished
  }

  return { map, setFrame }
}
