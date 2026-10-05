/**
 * Area outlines as a tile overlay of their own.
 *
 * State borders, county lines, a river basin's rim: shapes the map should
 * draw quietly, once, under everything else. {@link createVectorTileAreaIndex}
 * already reads GeoJSON polygons into a projected index and
 * {@link paintVectorTileAreas} already paints one into a tile image; this puts
 * the two behind `imageForTile`, so a layer registry can place the outlines
 * beneath a network overlay with its `order`, and dim them with the overlay's
 * opacity.
 *
 * Why a tile overlay and not MapKit's own polygon overlays: the map already
 * draws its tile overlays in a stated order (`MapKitLayerRegistry`), which its
 * vector overlays do not share, and a few thousand vertices painted into
 * 256 px tiles cost less than a few thousand MapKit overlay vertices that
 * re-project on every frame of a pan.
 *
 * A shared edge is stroked once by each area that owns it. Paint with an
 * opaque colour and quieten the layer with the overlay's opacity, not with
 * `strokeOpacity`, and the two strokes read as one line.
 */
import { paintVectorTileAreas, vectorTileAreasReach } from './vector-tile-areas.js'

import type { VectorTileAreaLayer } from './vector-tile-areas.js'
import type { VectorTileCanvas } from './vector-tiles.js'

export interface AreaOutlineTileSourceOptions<TCanvas extends VectorTileCanvas> {
  createCanvas: (width: number, height: number) => TCanvas
  /** What to draw, or `null` for nothing yet. Replace it with {@link AreaOutlineTileSource.setLayer}. */
  layer?: VectorTileAreaLayer | null
  /** Logical tile size before the device scale. MapKit asks for 256. */
  tileSize?: number
}

export interface AreaOutlineTileSource<TCanvas extends VectorTileCanvas> {
  /** Pass as the `imageForTile` of a layer descriptor. `null` for a tile nothing reaches. */
  imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>
  readonly layer: VectorTileAreaLayer | null
  /** Draw another layer from the next tile on. The caller replaces the overlay to repaint at once. */
  setLayer: (layer: VectorTileAreaLayer | null) => void
}

export function createAreaOutlineTileSource<TCanvas extends VectorTileCanvas>(
  options: AreaOutlineTileSourceOptions<TCanvas>,
): AreaOutlineTileSource<TCanvas> {
  const { createCanvas, tileSize = 256 } = options
  let layer = options.layer ?? null
  return {
    async imageForTile(x, y, z, scale) {
      const current = layer
      if (!current) return null
      const tile = { x, y, z }
      if (!vectorTileAreasReach(current, tile, tileSize)) return null
      const pixelRatio = scale > 0 ? scale : 1
      const size = Math.round(tileSize * pixelRatio)
      const canvas = createCanvas(size, size)
      return paintVectorTileAreas(canvas, current, { pixelRatio, tile, tileSize }) ? canvas : null
    },
    get layer() {
      return layer
    },
    setLayer(next) {
      layer = next
    },
  }
}
