import {
  MapKitLayerRegistry,
  initializeMapKit,
  regionForMapKitLayer,
} from '@narduk-enterprises/narduk-mapkit/client'

import type {
  MapKitLayerDescriptor,
  MapKitTileOverlayUrlTemplate,
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
  TileOverlay: new (
    urlTemplate: MapKitTileOverlayUrlTemplate,
    options?: Record<string, unknown>,
  ) => TileOverlay
}

interface TileOverlay {
  opacity: number
}

declare global {
  interface Window {
    mapkit?: MapKitNamespace
  }
}

const vegetationLayer: MapKitLayerDescriptor = {
  bounds: [-97.706, 30.198, -97.692, 30.209],
  id: 'vegetation',
  maximumZ: 16,
  minimumZ: 10,
  opacity: 0.6,
  urlTemplate: '/tiles/vegetation/2026-07-01/{z}/{x}/{y}@{scale}x.png',
}

const moistureLayer: MapKitLayerDescriptor = {
  bounds: [-97.706, 30.198, -97.692, 30.209],
  id: 'moisture',
  maximumZ: 16,
  minimumZ: 10,
  opacity: 0.4,
  urlTemplate: '/tiles/moisture/2026-07-01/{z}/{x}/{y}@{scale}x.png',
}

export async function mountLayerRegistryMap(container: HTMLElement) {
  await initializeMapKit({ tokenEndpoint: '/api/mapkit-token' })
  const mapkit = window.mapkit
  if (!mapkit) throw new Error('MapKit JS did not expose window.mapkit')

  const map = new mapkit.Map(container, { isRotationEnabled: false })
  map.region = regionForMapKitLayer(mapkit, vegetationLayer)

  const registry = new MapKitLayerRegistry<TileOverlay>({
    crossfadeDurationMs: 400,
    map,
    mapkit,
  })

  // One-shot multi-layer stack (independent opacity). Prefer reconcile when the
  // desired set changes over time — e.g. earthdata-viewer companion datasets.
  await registry.reconcile([vegetationLayer, moistureLayer], { crossfadeDurationMs: 0 })

  async function replaceVegetationFrame(urlTemplate: string): Promise<void> {
    await registry.replace('vegetation', {
      ...vegetationLayer,
      urlTemplate,
    })
  }

  async function setStack(
    layers: Array<typeof vegetationLayer | typeof moistureLayer>,
  ): Promise<void> {
    await registry.reconcile(layers, { crossfadeDurationMs: 0 })
  }

  return { map, registry, replaceVegetationFrame, setStack }
}
