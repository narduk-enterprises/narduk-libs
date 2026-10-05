/**
 * Everything outside some areas, covered: a cut-out.
 *
 * A state page wants the map to show that state and nothing else, with the
 * country around it quietly blanked. This is the inverse of
 * {@link createAreaOutlineTileSource}: a tile overlay whose image is a flat
 * colour with the chosen areas cut out of it, and, if asked, a line round each
 * cut-out. Place it above the network in a layer registry and the network, the
 * basemap and anything below it show only inside the areas.
 *
 * The cut is one even-odd fill: the tile's rectangle plus the rings of the
 * areas, so a point of the tile is covered when it lies inside an even number
 * of those shapes. A hole in an area (a lake of its own, an enclave) is
 * covered again, which is the right answer for a state. Each area is read from
 * the same index the outline source and the pointer use, so a multi-polygon
 * (Michigan's two peninsulas, Hawaii's islands, the Aleutians on either side
 * of the antimeridian) is cut out in every part. The shapes are also tried one
 * world to the east and west, so a map that shows the world repeated, or asks
 * for a tile index outside 0..2^z-1, is cut at the same places.
 *
 * A tile no area reaches is one flat colour: those images are made once per
 * size and shared, like any solid overlay tile.
 */
import type {
  VectorTileAddress,
  VectorTileAreaIndex,
  VectorTileAreaShape,
} from './vector-tile-areas.js'
import type { VectorTileCanvas } from './vector-tiles.js'

export interface AreaMaskLayer<TData = unknown> {
  /** The cut-out's line, drawn over the mask's edge. Omit for none. */
  edge?: { color: string; opacity?: number; width: number }
  /** The covering colour. Opaque is the point; quieten it with the overlay's opacity. */
  fillColor: string
  /** Default 1. */
  fillOpacity?: number
  /** Which areas stay uncovered. Default: every area of the index. */
  ids?: readonly string[]
  index: VectorTileAreaIndex<TData>
}

export interface AreaMaskTileSourceOptions<TCanvas extends VectorTileCanvas> {
  createCanvas: (width: number, height: number) => TCanvas
  /** What to cover, or `null` for no mask yet (every tile answers `null`). */
  layer?: AreaMaskLayer | null
  /** Logical tile size before the device scale. MapKit asks for 256. */
  tileSize?: number
}

export interface AreaMaskTileSource<TCanvas extends VectorTileCanvas> {
  /** Pass as the `imageForTile` of a layer descriptor. */
  imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>
  readonly layer: AreaMaskLayer | null
  /** Use another mask from the next tile on. The caller replaces the overlay to repaint at once. */
  setLayer: (layer: AreaMaskLayer | null) => void
}

/** Vertices closer than this, in device pixels, to the last one drawn are skipped. */
const MIN_VERTEX_GAP_PX = 0.4
/** Room past a tile's edge in which a shape's edge line may still reach it, in CSS pixels. */
const EDGE_REACH_PX = 4
const WORLD_COPIES = [-1, 0, 1] as const

function maskContext(canvas: VectorTileCanvas) {
  const context = canvas.getContext('2d')
  if (!context || !context.fill || !context.closePath) return null
  return context as typeof context & {
    closePath: () => void
    fill: (rule?: 'evenodd' | 'nonzero') => void
  }
}

function shapeReaches(
  shape: VectorTileAreaShape,
  copy: number,
  tile: VectorTileAddress,
  margin: number,
): boolean {
  const span = 1 / 2 ** tile.z
  return (
    shape.box[2] + copy >= tile.x * span - margin &&
    shape.box[0] + copy <= (tile.x + 1) * span + margin &&
    shape.box[3] >= tile.y * span - margin &&
    shape.box[1] <= (tile.y + 1) * span + margin
  )
}

export function createAreaMaskTileSource<TCanvas extends VectorTileCanvas>(
  options: AreaMaskTileSourceOptions<TCanvas>,
): AreaMaskTileSource<TCanvas> {
  const { createCanvas, tileSize = 256 } = options
  let layer = options.layer ?? null
  /** One flat image per size and layer, for every tile the cut-out does not reach. */
  let solid: { key: string; canvas: TCanvas } | null = null

  function solidTile(size: number, current: AreaMaskLayer): TCanvas | null {
    const key = `${size}|${current.fillColor}|${current.fillOpacity ?? 1}`
    if (solid?.key === key) return solid.canvas
    const canvas = createCanvas(size, size)
    const context = maskContext(canvas)
    if (!context) return null
    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(size, 0)
    context.lineTo(size, size)
    context.lineTo(0, size)
    context.closePath()
    context.globalAlpha = current.fillOpacity ?? 1
    context.fillStyle = current.fillColor
    context.fill()
    context.globalAlpha = 1
    solid = { canvas, key }
    return canvas
  }

  return {
    async imageForTile(x, y, z, scale) {
      const current = layer
      if (!current) return null
      const pixelRatio = scale > 0 ? scale : 1
      const size = Math.round(tileSize * pixelRatio)
      const tile = { x, y, z }
      const tiles = 2 ** z
      const margin = EDGE_REACH_PX / tileSize / tiles
      const wanted = current.ids ? new Set(current.ids) : null
      const areas = current.index.areas.filter((area) => !wanted || wanted.has(area.id))
      const reached: Array<{ copy: number; shape: VectorTileAreaShape }> = []
      for (const area of areas) {
        for (const shape of area.shapes) {
          for (const copy of WORLD_COPIES) {
            if (shapeReaches(shape, copy, tile, margin)) reached.push({ copy, shape })
          }
        }
      }
      if (reached.length === 0) return solidTile(size, current)

      const canvas = createCanvas(size, size)
      const context = maskContext(canvas)
      if (!context) return null
      const scalePx = tileSize * pixelRatio * tiles
      const originX = x * tileSize * pixelRatio
      const originY = y * tileSize * pixelRatio

      context.beginPath()
      context.moveTo(0, 0)
      context.lineTo(size, 0)
      context.lineTo(size, size)
      context.lineTo(0, size)
      context.closePath()
      for (const { copy, shape } of reached) {
        const { coordinates, ringStarts } = shape
        for (let ring = 0; ring + 1 < ringStarts.length; ring += 1) {
          const start = ringStarts[ring] ?? 0
          const end = ringStarts[ring + 1] ?? start
          if (end - start < 3) continue
          let lastX = ((coordinates[start * 2] ?? 0) + copy) * scalePx - originX
          let lastY = (coordinates[start * 2 + 1] ?? 0) * scalePx - originY
          context.moveTo(lastX, lastY)
          for (let point = start + 1; point < end; point += 1) {
            const px = ((coordinates[point * 2] ?? 0) + copy) * scalePx - originX
            const py = (coordinates[point * 2 + 1] ?? 0) * scalePx - originY
            if (
              point + 1 < end &&
              Math.abs(px - lastX) + Math.abs(py - lastY) < MIN_VERTEX_GAP_PX
            ) {
              continue
            }
            context.lineTo(px, py)
            lastX = px
            lastY = py
          }
          context.closePath()
        }
      }
      context.globalAlpha = current.fillOpacity ?? 1
      context.fillStyle = current.fillColor
      context.fill('evenodd')

      if (current.edge && current.edge.width > 0) {
        // Stroke the cut-out alone: a second path without the tile's rectangle.
        context.beginPath()
        for (const { copy, shape } of reached) {
          const { coordinates, ringStarts } = shape
          for (let ring = 0; ring + 1 < ringStarts.length; ring += 1) {
            const start = ringStarts[ring] ?? 0
            const end = ringStarts[ring + 1] ?? start
            if (end - start < 3) continue
            context.moveTo(
              ((coordinates[start * 2] ?? 0) + copy) * scalePx - originX,
              (coordinates[start * 2 + 1] ?? 0) * scalePx - originY,
            )
            for (let point = start + 1; point < end; point += 1) {
              context.lineTo(
                ((coordinates[point * 2] ?? 0) + copy) * scalePx - originX,
                (coordinates[point * 2 + 1] ?? 0) * scalePx - originY,
              )
            }
            context.closePath()
          }
        }
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.globalAlpha = current.edge.opacity ?? 1
        context.strokeStyle = current.edge.color
        context.lineWidth = current.edge.width * pixelRatio
        context.stroke()
      }
      context.globalAlpha = 1
      return canvas
    },
    get layer() {
      return layer
    },
    setLayer(next) {
      layer = next
      solid = null
    },
  }
}
