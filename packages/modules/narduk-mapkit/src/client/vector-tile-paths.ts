/**
 * The screen geometry of a path through a vector tile network.
 *
 * An effect that follows a river (a pulse travelling downstream, an arrow
 * along it) needs the river's line, in order, in screen pixels. The tiles hold
 * it as pieces: a stretch is cut at every tile edge, and the tile's clip
 * buffer repeats a little of the line on both sides of that edge. This turns
 * the pieces of a path's stretches, read from decoded tiles already in
 * memory, into lines a canvas can stroke: clipped to each tile's own bounds so
 * nothing is drawn twice, projected with the view the label layer and the dot
 * layer use, and sorted along the path.
 *
 * It reads nothing and fetches nothing. A tile that is not decoded yet adds no
 * piece; the caller asks again once the map has settled.
 *
 * Direction is the tiles': a line runs the way its source digitised it. For
 * the national river network that is upstream to downstream (NHDPlus), so a
 * path listed from upstream to downstream comes back oriented the way the
 * water goes.
 */
import { projectToWorldFraction, requirePointLayerView } from './point-layer.js'

import type { PointLayerView } from './point-layer.js'
import type { DecodedVectorTile } from './vector-tiles.js'

/** `si` value of a feature that carries none; never a stretch. */
const MISSING_ID = 0xffff_ffff

/** Metres round the equator, as Web Mercator measures them. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.685_578_5

/** One stretch of a path, in the order the water (or the traveller) goes. */
export interface VectorTilePathStretch {
  /** The feature id the tiles carry (`si` for the national river network). */
  id: number
  /** Ground length of the whole stretch in metres, for the distance a piece starts at. */
  meters: number
}

/** One drawable line of a path, in screen pixels. */
export interface VectorTilePathPiece {
  /** Metres from the start of the path to where this piece begins. */
  distanceM: number
  /** The stretch's feature id. */
  id: number
  /** Interleaved `x, y` in CSS pixels from the top-left of the view; two points or more. */
  points: Float32Array
  /** Index of the stretch in the path it came from. */
  rank: number
}

/** Pixels one metre of ground spans at this view's latitude and zoom. */
export function pixelsPerMeter(view: PointLayerView): number {
  const { pixelsPerWorld } = requirePointLayerView(view)
  const cosine = Math.max(Math.cos((view.latitude * Math.PI) / 180), 1e-6)
  return pixelsPerWorld / (EARTH_CIRCUMFERENCE_M * cosine)
}

/** The tile addresses a view reaches at one zoom, with its margin. */
export function tilesInView(
  view: PointLayerView,
  zoom: number,
  marginPx: number,
): Array<{ x: number; y: number }> {
  const { halfHeight, halfWidth, pixelsPerWorld } = requirePointLayerView(view)
  const center = projectToWorldFraction(view.longitude, view.latitude)
  const tiles = 2 ** zoom
  const west = Math.floor((center.x - (halfWidth + marginPx) / pixelsPerWorld) * tiles)
  const east = Math.floor((center.x + (halfWidth + marginPx) / pixelsPerWorld) * tiles)
  const north = Math.max(
    0,
    Math.floor((center.y - (halfHeight + marginPx) / pixelsPerWorld) * tiles),
  )
  const south = Math.min(
    tiles - 1,
    Math.floor((center.y + (halfHeight + marginPx) / pixelsPerWorld) * tiles),
  )
  const out: Array<{ x: number; y: number }> = []
  for (let y = north; y <= south; y += 1) {
    for (let x = west; x <= east; x += 1) out.push({ x, y })
  }
  return out
}

/** Liang-Barsky against `0..extent` on both axes: the parameter range inside, or `null`. */
function clipToTile(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  extent: number,
): [number, number] | null {
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [ax, extent - ax, ay, extent - ay]
  for (let edge = 0; edge < 4; edge += 1) {
    const pe = p[edge] as number
    const qe = q[edge] as number
    if (pe === 0) {
      if (qe < 0) return null
      continue
    }
    const t = qe / pe
    if (pe < 0) {
      if (t > t1) return null
      if (t > t0) t0 = t
    } else {
      if (t < t0) return null
      if (t < t1) t1 = t
    }
  }
  return [t0, t1]
}

interface RawPiece {
  length: number
  points: Float32Array
}

/**
 * The lines of one feature inside its tile's own bounds, projected to screen
 * pixels. Appends to `into`.
 */
function appendFeaturePieces(
  tile: DecodedVectorTile,
  feature: number,
  origin: { scale: number; x: number; y: number },
  into: RawPiece[],
) {
  const { coordinates, extent, featureLines, lineStarts } = tile
  const lastLine = featureLines[feature + 1] ?? 0
  const { scale, x: originX, y: originY } = origin
  for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
    const start = lineStarts[line] ?? 0
    const end = lineStarts[line + 1] ?? start
    let run: number[] = []
    const flush = () => {
      if (run.length >= 4) {
        const points = new Float32Array(run)
        let length = 0
        for (let at = 2; at < points.length; at += 2) {
          length += Math.hypot(
            (points[at] as number) - (points[at - 2] as number),
            (points[at + 1] as number) - (points[at - 1] as number),
          )
        }
        into.push({ length, points })
      }
      run = []
    }
    for (let point = start; point + 1 < end; point += 1) {
      const ax = coordinates[point * 2] ?? 0
      const ay = coordinates[point * 2 + 1] ?? 0
      const bx = coordinates[point * 2 + 2] ?? 0
      const by = coordinates[point * 2 + 3] ?? 0
      const range = clipToTile(ax, ay, bx, by, extent)
      if (!range) {
        flush()
        continue
      }
      const [t0, t1] = range
      if (run.length === 0 || t0 > 0) {
        flush()
        run.push((ax + (bx - ax) * t0) * scale + originX, (ay + (by - ay) * t0) * scale + originY)
      }
      run.push((ax + (bx - ax) * t1) * scale + originX, (ay + (by - ay) * t1) * scale + originY)
      if (t1 < 1) flush()
    }
    flush()
  }
}

export interface CollectVectorTilePathPiecesOptions {
  /** Tiles beyond the view whose lines are still returned, in CSS pixels. Default 64. */
  marginPx?: number
  /** The stretches of the path, in order. A stretch the tiles lack adds no piece. */
  stretches: readonly VectorTilePathStretch[]
  /** The decoded tile at `z/x/y` (`x` wrapped into range), or nothing. */
  tileAt: (z: number, x: number, y: number) => DecodedVectorTile | null | undefined
  view: PointLayerView
  /** The tile zoom to read. */
  zoom: number
}

/**
 * The pieces of a path at one tile zoom, ordered along the path.
 *
 * Within one stretch the pieces are ordered along the stretch's own net
 * direction, so a stretch that crosses a tile edge comes back as two pieces,
 * upstream first. Each piece carries the metres from the start of the path to
 * where it begins: its stretch's start, plus its share of that stretch's
 * length by pixel length.
 */
export function collectVectorTilePathPieces(
  options: CollectVectorTilePathPiecesOptions,
): VectorTilePathPiece[] {
  const { marginPx = 64, stretches, tileAt, view, zoom } = options
  const { halfHeight, halfWidth, pixelsPerWorld } = requirePointLayerView(view)
  const center = projectToWorldFraction(view.longitude, view.latitude)

  const rankOf = new Map<number, number>()
  const starts: number[] = []
  let cumulative = 0
  for (const [rank, stretch] of stretches.entries()) {
    starts.push(cumulative)
    cumulative += Math.max(0, stretch.meters)
    if (!rankOf.has(stretch.id)) rankOf.set(stretch.id, rank)
  }
  if (rankOf.size === 0) return []

  const tiles = 2 ** zoom
  const byRank = new Map<number, RawPiece[]>()
  for (const address of tilesInView(view, zoom, marginPx)) {
    const wrapped = ((address.x % tiles) + tiles) % tiles
    const tile = tileAt(zoom, wrapped, address.y)
    const column = tile?.si
    if (!tile || !column) continue
    const unit = (1 / tiles) * pixelsPerWorld
    const origin = {
      // One tile unit in pixels, and where the tile's own origin lands on screen.
      scale: unit / tile.extent,
      x: (address.x / tiles - center.x) * pixelsPerWorld + halfWidth,
      y: (address.y / tiles - center.y) * pixelsPerWorld + halfHeight,
    }
    const count = column.length
    for (let feature = 0; feature < count; feature += 1) {
      const id = column[feature]
      if (id === undefined || id === MISSING_ID) continue
      const rank = rankOf.get(id)
      if (rank === undefined) continue
      let pieces = byRank.get(rank)
      if (!pieces) {
        pieces = []
        byRank.set(rank, pieces)
      }
      appendFeaturePieces(tile, feature, origin, pieces)
    }
  }

  const out: VectorTilePathPiece[] = []
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const pieces = byRank.get(rank) as RawPiece[]
    const stretch = stretches[rank] as VectorTilePathStretch
    if (pieces.length > 1) {
      // The stretch's net direction, then each piece by where its middle sits along it.
      let directionX = 0
      let directionY = 0
      for (const { points } of pieces) {
        directionX += (points[points.length - 2] as number) - (points[0] as number)
        directionY += (points[points.length - 1] as number) - (points[1] as number)
      }
      const key = (piece: RawPiece) =>
        (((piece.points[0] as number) + (piece.points[piece.points.length - 2] as number)) *
          directionX +
          ((piece.points[1] as number) + (piece.points[piece.points.length - 1] as number)) *
            directionY) /
        2
      pieces.sort((left, right) => key(left) - key(right))
    }
    let total = 0
    for (const piece of pieces) total += piece.length
    let before = 0
    for (const piece of pieces) {
      const share = total > 0 ? before / total : 0
      out.push({
        distanceM: (starts[rank] as number) + share * Math.max(0, stretch.meters),
        id: stretch.id,
        points: piece.points,
        rank,
      })
      before += piece.length
    }
  }
  return out
}

/** The tile zooms worth trying for a view, nearest the view's own first. */
export function candidateTileZooms(zoom: number, dataZoom: (zoom: number) => number): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const candidate of [
    Math.round(zoom),
    Math.floor(zoom),
    Math.ceil(zoom),
    Math.floor(zoom) - 1,
    Math.ceil(zoom) + 1,
  ]) {
    const at = Math.max(0, Math.min(dataZoom(candidate), MAP_ZOOM_LIMIT))
    if (seen.has(at)) continue
    seen.add(at)
    out.push(at)
  }
  return out
}

const MAP_ZOOM_LIMIT = 22
