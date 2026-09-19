import {
  createPmTilesFetchSource,
  createPmTilesTileSource,
  createVectorTileOverlaySource,
  createWorkerDecoder,
} from '@narduk-enterprises/narduk-mapkit/client'
import { PMTiles } from 'pmtiles'

import type { VectorTileHit } from '@narduk-enterprises/narduk-mapkit/client'

interface MapCoordinate {
  latitude: number
  longitude: number
}

interface MapHandle {
  addEventListener(type: 'single-tap', listener: (event: { pointOnPage: Point }) => void): void
  convertPointOnPageToCoordinate(point: Point): MapCoordinate | null
}

interface Point {
  x: number
  y: number
}

/**
 * Draw a dense river network from a PMTiles archive, and answer a tap on it.
 *
 * The three pieces this wires together: an archive read over HTTP ranges, a
 * worker that turns tile bytes into geometry, and an overlay source that
 * paints a tile on demand and keeps the decoded geometry for the next pass.
 * MapKit JS draws raster tiles only, so the network has to be painted before
 * MapKit sees it -- which also means MapKit cannot say what a tap landed on,
 * and `hitTest` answers that from the same decoded tiles.
 */
export function attachRiverNetwork(map: MapHandle, archiveUrl: string) {
  // The worker script belongs to the app: a published worker chunk is the one
  // thing Vite, webpack and Nuxt do not agree on. It should call
  // `serveVectorTileDecoder(self, createMvtDecoder({ layers: ['reaches'] }))`.
  const decoder = createWorkerDecoder({
    worker: new Worker(new URL('./workers/river-network.ts', import.meta.url), {
      type: 'module',
    }),
  })

  const tiles = createPmTilesTileSource({
    reader: new PMTiles(createPmTilesFetchSource({ url: archiveUrl })),
    onError: (reason) => reportDegraded(reason),
  })

  const network = createVectorTileOverlaySource({
    // 500 tiles of flowlines, not 500 tiles of pixels: `cacheBytes` reports
    // what this is actually holding, so the number can be set against a
    // budget instead of guessed.
    cacheSize: 500,
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    decode: decoder.decode,
    style: (properties, zoom) => {
      // Small headwaters are noise at continental zooms; returning null draws
      // nothing rather than drawing a hairline nobody asked for.
      const order = Number(properties.so ?? 0)
      if (order < 5 && zoom < 8) return null
      return { color: '#2563eb', width: order > 6 ? 2.5 : 1.25 }
    },
    tileBytes: (z, x, y, signal) => tiles.getTile(z, x, y, signal),
    tileSize: 256,
  })

  map.addEventListener('single-tap', (event) => {
    const coordinate = map.convertPointOnPageToCoordinate(event.pointOnPage)
    if (!coordinate) return
    // Synchronous, and only over tiles already decoded: a tap has to be
    // answered inside the gesture, and a tile the user can see is a tile the
    // cache holds. The default tolerance is a fingertip, not a pixel.
    const hit = network.hitTest({ coordinate, zoom: currentZoom() })
    if (hit) showReach(hit)
    else dismissReach()
  })

  return {
    /** Pass to `createMapKitAsyncTileOverlay`. */
    imageForTile: network.imageForTile,
    dispose() {
      network.clearCache()
      decoder.dispose()
    },
  }
}

declare function currentZoom(): number
declare function dismissReach(): void
declare function reportDegraded(reason: unknown): void
declare function showReach(hit: VectorTileHit): void
