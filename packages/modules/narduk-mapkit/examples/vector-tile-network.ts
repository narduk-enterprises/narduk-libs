import {
  createPmTilesFetchSource,
  createPmTilesTileSource,
  createVectorTileOverlaySource,
  createWorkerDecoder,
  resolveHit,
} from '@narduk-enterprises/narduk-mapkit/client'
import { PMTiles } from 'pmtiles'

import type {
  HitPointerKind,
  PointLayer,
  PointLayerCanvas,
  VectorTileClassTable,
  VectorTileHit,
  VectorTileRestyleHost,
} from '@narduk-enterprises/narduk-mapkit/client'

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
 *
 * Colour comes from a class table (one byte per `si` below zoom 8, per `ri`
 * from zoom 8). `restyle` / `setClassTable` repaint from that cache and swap
 * the overlay only once the new tiles have drawn, so a 5-minute status
 * refresh does not blank the network.
 */
export function attachRiverNetwork(
  map: MapHandle,
  archiveUrl: string,
  gauges?: PointLayer<PointLayerCanvas>,
) {
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
    // The cache is capped by bytes (64 MiB by default) as well as by count;
    // `network.cacheBytes` reports what it is actually holding.
    cacheSize: 500,
    // Reads for a zoom the map has left are dropped or aborted; at most six
    // are in flight at once, newest first.
    readConcurrency: 6,
    // Past the archive's last zoom, paint from its zoom-12 ancestor.
    archive: tiles,
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    decode: decoder.decode,
    style: {
      casing: { color: '#0f172a', extraWidth: 1 },
      classTable: emptyClassTable(),
      gaugeNotReporting: { color: '#f59e0b', width: 1.25 },
      noGauge: { color: '#93c5fd', width: 1.25 },
      paintByClass: statusPaint(),
      tileNetwork: { length: NETWORK_LENGTH, version: NETWORK_VERSION },
      unknown: { color: '#6b7280', width: 1.25 },
    },
    tileBytes: (z, x, y, signal) => tiles.getTile(z, x, y, signal),
    tileNetwork: { length: NETWORK_LENGTH, version: NETWORK_VERSION },
    tileSize: 256,
  })

  map.addEventListener('single-tap', (event) => {
    const coordinate = map.convertPointOnPageToCoordinate(event.pointOnPage)
    if (!coordinate) return
    // One answer, in priority order: a gauge dot wins over a river line, a
    // line over an alert area. Synchronous, and only over what is already
    // decoded: a tap has to be answered inside the gesture. The tolerance is
    // 8 px for a mouse and 22 px (half of a 44 px touch target) for a finger.
    const hit = resolveHit({
      coordinate,
      layers: [
        ...(gauges ? [{ kind: 'point' as const, layer: gauges }] : []),
        { kind: 'line', source: network },
        { kind: 'area', test: ({ coordinate: at }) => alertAreaAt(at) },
      ],
      pointer: lastPointerKind(),
      zoom: currentZoom(),
    })
    if (hit?.kind === 'point') showGauge(hit.hit)
    else if (hit?.kind === 'line') {
      showReach(hit.hit)
      // Light the whole stretch, in every tile that is drawn, on its own
      // overlay: the network tiles are not re-read, decoded or repainted.
      const segment = hit.hit.properties.si
      if (typeof segment === 'number') {
        void network.setHighlight({
          id: segment,
          style: { casing: { color: '#ffffff', extraWidth: 2 }, color: '#f97316', width: 4 },
        })
      }
    } else if (hit?.kind === 'area') showAlert(hit.hit)
    else {
      dismissReach()
      void network.clearHighlight()
    }
  })

  return {
    /** Pass to `createMapKitAsyncTileOverlay` or a registry descriptor. */
    imageForTile: network.imageForTile,
    /**
     * Attach the layer registry so `restyle` / `setClassTable` swap the
     * overlay only after the new image has drawn.
     */
    bindRegistry(host: VectorTileRestyleHost<OffscreenCanvas>) {
      network.setRestyleHost(host)
    },
    /**
     * The highlight's own layer, registered above the network with
     * `imageForTile: network.highlightImageForTile`. Changing the highlight
     * swaps only this one.
     */
    bindHighlightRegistry(host: VectorTileRestyleHost<OffscreenCanvas>) {
      network.setHighlightHost(host)
    },
    restyleForLens(table: VectorTileClassTable) {
      return network.setClassTable(table)
    },
    dispose() {
      network.clearCache()
      decoder.dispose()
    },
  }
}

const NETWORK_VERSION = 2
const NETWORK_LENGTH = 3_002_168

function emptyClassTable(): VectorTileClassTable {
  return {
    classes: new Uint8Array(NETWORK_LENGTH),
    length: NETWORK_LENGTH,
    networkVersion: NETWORK_VERSION,
  }
}

function statusPaint() {
  const paint = new Array<{ color: string; width: number } | undefined>(254)
  paint[1] = { color: '#2563eb', width: 1.25 }
  paint[9] = { color: '#dc2626', width: 2 }
  return paint
}

declare function alertAreaAt(at: MapCoordinate): { id: string } | null
declare function currentZoom(): number
declare function dismissReach(): void
declare function lastPointerKind(): HitPointerKind
declare function reportDegraded(reason: unknown): void
declare function showAlert(area: { id: string }): void
declare function showGauge(index: number): void
declare function showReach(hit: VectorTileHit): void
