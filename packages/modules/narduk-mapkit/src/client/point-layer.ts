/**
 * Canvas point layer: tens of thousands of dots painted into tile images.
 *
 * The national river map has to show every gauge at once (23,597 today) at
 * continental zoom. A DOM annotation per gauge was built around hundreds, and
 * MapKit JS still has no vector point overlay, so the same path the line
 * painter uses -- paint a tile, hand MapKit the image -- is what this does
 * for dots.
 *
 * Input is columnar typed arrays, not an array of objects: interleaved
 * longitude/latitude, a class byte per point, an optional flags column.
 * Positions are projected once. Replacing the class column, or the style
 * table, restyles from those projected coordinates; nothing is refetched and
 * nothing is re-projected. A missing class does not fall back to zero.
 *
 * Reserved class bytes keep "no data" and "not reporting" visually distinct
 * from each other and from the lowest real class. Those states are unknown,
 * not a guess and not a zero.
 */

import { projectToTilePoint } from './hit-test.js'

import type { VectorTileCoordinate } from './hit-test.js'

/** Class byte for a gauge with no observation. Not zero, and not a guess. */
export const POINT_CLASS_NO_DATA = 255

/** Class byte for a gauge that is not reporting. Distinct from no-data. */
export const POINT_CLASS_NOT_REPORTING = 254

/**
 * Per-tile CPU budget for painting the national gauge set (23,597 points) at
 * zoom 3–4, including a 2× device pixel ratio. Measured in
 * `tests/point-layer.test.ts`. The work is the index walk plus draw calls;
 * rasterisation cost is the host's.
 */
export const POINT_LAYER_NATIONAL_TILE_BUDGET_MS = 50

const DEFAULT_TILE_SIZE = 256
const DEFAULT_STROKE_WIDTH = 1
const MAX_ZOOM = 22

/** How a class byte is painted. Higher `order` is drawn later, on top. */
export interface PointClassStyle {
  fill: string
  /** Higher severity paints later so it stays visible in a pile-up. */
  order: number
  /** Radius in CSS pixels, before the device pixel ratio. */
  radius: number
  stroke: string
  /** Stroke width in CSS pixels. Default 1. */
  strokeWidth?: number
}

/**
 * Style table keyed by class byte. The two reserved classes are required so
 * they cannot silently inherit class 0.
 */
export interface PointClassTable {
  readonly [POINT_CLASS_NO_DATA]: PointClassStyle
  readonly [POINT_CLASS_NOT_REPORTING]: PointClassStyle
  readonly [classByte: number]: PointClassStyle | undefined
}

export type PointPositions = Float32Array | Float64Array

/** The 2D canvas surface the painter needs, narrowed to what it calls. */
export interface PointLayerCanvas {
  height: number
  width: number
  getContext: (contextId: '2d') => PointLayerCanvasContext | null
}

export interface PointLayerCanvasContext {
  fillStyle: string | object
  lineWidth: number
  strokeStyle: string | object
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void
  beginPath: () => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  fill: () => void
  stroke: () => void
}

export interface PointLayerOptions<TCanvas extends PointLayerCanvas> {
  /** One class byte per point. Replaced with {@link PointLayer.setClasses}. */
  classes: Uint8Array
  createCanvas: (width: number, height: number) => TCanvas
  /**
   * Optional flags column, one byte per point. L1 carries it aligned with the
   * other columns and does not interpret the bits.
   */
  flags?: Uint8Array
  /** Interleaved longitude, latitude. `Float32Array` or `Float64Array` only. */
  positions: PointPositions
  style: PointClassTable
  /** Logical tile size before `scale`. MapKit asks for 256 or 512. */
  tileSize?: number
}

export interface PointLayer<TCanvas extends PointLayerCanvas> {
  /** Pass to `createMapKitAsyncTileOverlay` or a `MapKitAsyncLayerDescriptor`. */
  imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>
  /**
   * Index of the nearest painted dot within `toleranceInPixels`, or `null`.
   *
   * When the tap sits inside more than one dot, the one with the higher draw
   * order wins -- that is the one the user can see. A miss is `null`, not 0.
   */
  nearestPoint: (
    coordinate: VectorTileCoordinate,
    toleranceInPixels: number,
    zoom: number,
  ) => number | null
  readonly pointCount: number
  /** Replace the class column. Positions stay as they were projected. */
  setClasses: (classes: Uint8Array) => void
  /** Swap the style table. Cached projection and the spatial index stay. */
  setStyle: (style: PointClassTable) => void
}

/** Style after defaults (`strokeWidth`) are filled in. One slot per class byte. */
export interface PointLayerStyleSlot {
  fill: string
  order: number
  radius: number
  stroke: string
  strokeWidth: number
}

type StyleSlots = ReadonlyArray<PointLayerStyleSlot | undefined>

/**
 * Tiles a styled dot occupies at `zoom`, including neighbours its radius
 * straddles. Longitude wraps; latitude does not.
 */
export function pointLayerTilesForPoint(
  coordinate: VectorTileCoordinate,
  zoom: number,
  radiusPx: number,
  tileSize: number = DEFAULT_TILE_SIZE,
): Array<{ x: number; y: number }> {
  const level = requireZoom(zoom)
  const world = projectWorld(coordinate.longitude, coordinate.latitude)
  const n = 1 << level
  const reachPx = reachPixels(radiusPx, DEFAULT_STROKE_WIDTH)
  const tiles: Array<{ x: number; y: number }> = []
  for (const tile of neighbourTiles(world.x, world.y, level, reachPx, tileSize)) {
    if (pointReachesTile(world.x, world.y, tile.x, tile.y, n, reachPx, tileSize)) {
      tiles.push(tile)
    }
  }
  return tiles
}

/**
 * Paint the points that belong to one tile. Exported so a test can call it
 * without standing up the overlay source.
 */
export function paintPointLayerTile(
  canvas: PointLayerCanvas,
  options: {
    classes: Uint8Array
    indexes: ArrayLike<number>
    pixelRatio: number
    style: ReadonlyArray<PointLayerStyleSlot | undefined>
    tileSize: number
    tileX: number
    tileY: number
    worldX: Float64Array
    worldY: Float64Array
    zoom: number
  },
): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { classes, indexes, pixelRatio, style, tileSize, tileX, tileY, worldX, worldY, zoom } =
    options
  const n = 1 << zoom
  const size = tileSize * pixelRatio
  context.clearRect(0, 0, canvas.width, canvas.height)

  const ordered = orderIndexes(indexes, classes, style)
  let painted = false
  for (const index of ordered) {
    const paint = style[classes[index] ?? -1]
    if (!paint) continue
    const local = tileLocal(worldX[index] ?? 0, worldY[index] ?? 0, tileX, tileY, n)
    const cx = local.x * size
    const cy = local.y * size
    const radius = paint.radius * pixelRatio
    if (!(radius > 0)) continue
    context.beginPath()
    context.arc(cx, cy, radius, 0, Math.PI * 2)
    context.fillStyle = paint.fill
    context.fill()
    context.strokeStyle = paint.stroke
    context.lineWidth = paint.strokeWidth * pixelRatio
    context.stroke()
    painted = true
  }
  return painted
}

export function createPointLayer<TCanvas extends PointLayerCanvas>(
  options: PointLayerOptions<TCanvas>,
): PointLayer<TCanvas> {
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new RangeError('tileSize must be a positive finite number')
  }

  const positions = requirePositions(options.positions)
  const pointCount = positions.length / 2
  let classes = requireColumn(options.classes, pointCount, 'classes')
  if (options.flags !== undefined) requireColumn(options.flags, pointCount, 'flags')
  let style = compileStyle(options.style)

  const worldX = new Float64Array(pointCount)
  const worldY = new Float64Array(pointCount)
  projectPositions(positions, worldX, worldY)

  const { createCanvas } = options
  const centerIndex = new Map<number, Map<string, Uint32Array>>()

  function indexesAtZoom(zoom: number): Map<string, Uint32Array> {
    const existing = centerIndex.get(zoom)
    if (existing) return existing
    const built = buildCenterIndex(worldX, worldY, zoom)
    centerIndex.set(zoom, built)
    return built
  }

  function maxReachPx(): number {
    let max = 0
    for (const entry of style) {
      if (!entry) continue
      max = Math.max(max, reachPixels(entry.radius, entry.strokeWidth))
    }
    return max
  }

  function collectTilePoints(tileX: number, tileY: number, zoom: number, reachPx: number) {
    const n = 1 << zoom
    const byTile = indexesAtZoom(zoom)
    const collected: number[] = []
    for (const neighbour of neighbourTilesForTile(tileX, tileY, zoom, reachPx, tileSize)) {
      const bucket = byTile.get(tileKey(neighbour.x, neighbour.y))
      if (!bucket) continue
      for (const index of bucket) {
        const paint = style[classes[index] ?? -1]
        if (!paint) continue
        const pointReach = reachPixels(paint.radius, paint.strokeWidth)
        if (
          pointReachesTile(
            worldX[index] ?? 0,
            worldY[index] ?? 0,
            tileX,
            tileY,
            n,
            pointReach,
            tileSize,
          )
        ) {
          collected.push(index)
        }
      }
    }
    return collected
  }

  return {
    async imageForTile(x, y, z, scale) {
      const zoom = requireZoom(z)
      const n = 1 << zoom
      if (x < 0 || y < 0 || x >= n || y >= n) return null
      const pixelRatio = scale > 0 ? scale : 1
      const indexes = collectTilePoints(x, y, zoom, maxReachPx())
      if (indexes.length === 0) return null
      const size = Math.round(tileSize * pixelRatio)
      const canvas = createCanvas(size, size)
      const painted = paintPointLayerTile(canvas, {
        classes,
        indexes,
        pixelRatio,
        style,
        tileSize,
        tileX: x,
        tileY: y,
        worldX,
        worldY,
        zoom,
      })
      return painted ? canvas : null
    },
    nearestPoint(coordinate, toleranceInPixels, zoom) {
      if (!Number.isFinite(toleranceInPixels) || toleranceInPixels < 0) {
        throw new RangeError('toleranceInPixels must be a finite number >= 0')
      }
      const level = requireZoom(zoom)
      if (pointCount === 0) return null
      const probe = projectWorld(coordinate.longitude, coordinate.latitude)
      const pixelsPerWorld = tileSize * (1 << level)
      const byTile = indexesAtZoom(level)
      const haloPx = Math.max(toleranceInPixels, maxReachPx())
      let best: Candidate | null = null

      for (const tile of neighbourTiles(probe.x, probe.y, level, haloPx, tileSize)) {
        const bucket = byTile.get(tileKey(tile.x, tile.y))
        if (!bucket) continue
        for (const index of bucket) {
          const paint = style[classes[index] ?? -1]
          if (!paint) continue
          const dx = wrapDelta(probe.x, worldX[index] ?? 0) * pixelsPerWorld
          const dy = (probe.y - (worldY[index] ?? 0)) * pixelsPerWorld
          const distancePx = Math.hypot(dx, dy)
          if (distancePx > toleranceInPixels) continue
          const next: Candidate = {
            distancePx,
            index,
            order: paint.order,
            radiusPx: reachPixels(paint.radius, paint.strokeWidth),
          }
          if (!best || betterCandidate(next, best)) best = next
        }
      }

      return best ? best.index : null
    },
    get pointCount() {
      return pointCount
    },
    setClasses(next) {
      classes = requireColumn(next, pointCount, 'classes')
    },
    setStyle(next) {
      style = compileStyle(next)
    },
  }
}

interface Candidate {
  distancePx: number
  index: number
  order: number
  radiusPx: number
}

/**
 * Prefer the visible (higher-order) dot when the tap sits inside more than
 * one, otherwise the nearer centre. A miss stays `null`, never index 0.
 */
function betterCandidate(candidate: Candidate, current: Candidate): boolean {
  const candidateInside = candidate.distancePx <= candidate.radiusPx
  const currentInside = current.distancePx <= current.radiusPx
  if (candidateInside !== currentInside) return candidateInside
  if (candidateInside && currentInside && candidate.order !== current.order) {
    return candidate.order > current.order
  }
  if (candidate.distancePx !== current.distancePx) {
    return candidate.distancePx < current.distancePx
  }
  if (candidate.order !== current.order) return candidate.order > current.order
  return candidate.index < current.index
}

function requirePositions(positions: PointPositions): PointPositions {
  if (!(positions instanceof Float32Array) && !(positions instanceof Float64Array)) {
    throw new TypeError(
      'positions must be a Float32Array or Float64Array of interleaved longitude/latitude pairs',
    )
  }
  if (positions.length % 2 !== 0) {
    throw new RangeError('positions length must be even (longitude, latitude per point)')
  }
  return positions
}

function requireColumn(column: Uint8Array, pointCount: number, name: string): Uint8Array {
  if (!(column instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Uint8Array with one byte per point`)
  }
  if (column.length !== pointCount) {
    throw new RangeError(
      `${name} length (${column.length}) must equal the point count (${pointCount})`,
    )
  }
  return column
}

function requireZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > MAX_ZOOM) {
    throw new RangeError(`zoom must be a finite number between 0 and ${MAX_ZOOM}`)
  }
  return Math.trunc(zoom)
}

function projectPositions(positions: PointPositions, worldX: Float64Array, worldY: Float64Array) {
  const count = worldX.length
  for (let index = 0; index < count; index += 1) {
    const longitude = positions[index * 2]
    const latitude = positions[index * 2 + 1]
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude)
    ) {
      throw new RangeError(
        `positions[${index}] is not a finite longitude/latitude pair; unknown is a class byte, not a NaN`,
      )
    }
    const world = projectWorld(longitude, latitude)
    worldX[index] = world.x
    worldY[index] = world.y
  }
}

function projectWorld(longitude: number, latitude: number): { x: number; y: number } {
  const point = projectToTilePoint({ latitude, longitude }, 0, 1)
  const x = (point.x + point.tileX) % 1
  return { x: x < 0 ? x + 1 : x, y: point.y + point.tileY }
}

function compileStyle(style: PointClassTable): StyleSlots {
  const noData = style[POINT_CLASS_NO_DATA]
  const notReporting = style[POINT_CLASS_NOT_REPORTING]
  if (!noData) {
    throw new RangeError(
      `style must include reserved class ${POINT_CLASS_NO_DATA} (no data); nothing defaults to zero`,
    )
  }
  if (!notReporting) {
    throw new RangeError(
      `style must include reserved class ${POINT_CLASS_NOT_REPORTING} (not reporting); nothing defaults to zero`,
    )
  }

  const slots: Array<PointLayerStyleSlot | undefined> = Array.from({ length: 256 })
  for (let classByte = 0; classByte < 256; classByte += 1) {
    const entry = style[classByte]
    if (!entry) continue
    slots[classByte] = compileClassStyle(entry, classByte)
  }

  const compiledNoData = slots[POINT_CLASS_NO_DATA]
  const compiledNotReporting = slots[POINT_CLASS_NOT_REPORTING]
  if (!compiledNoData || !compiledNotReporting) {
    throw new RangeError('reserved class styles must be complete')
  }
  if (sameLook(compiledNoData, compiledNotReporting)) {
    throw new RangeError('no-data and not-reporting styles must be visually distinct')
  }

  let lowest: PointLayerStyleSlot | undefined
  for (let classByte = 0; classByte <= 253; classByte += 1) {
    const entry = slots[classByte]
    if (!entry) continue
    if (!lowest || entry.order < lowest.order) lowest = entry
  }
  if (lowest && (sameLook(compiledNoData, lowest) || sameLook(compiledNotReporting, lowest))) {
    throw new RangeError(
      'reserved no-data and not-reporting styles must stay visually distinct from the lowest real class',
    )
  }

  return slots
}

function compileClassStyle(entry: PointClassStyle, classByte: number): PointLayerStyleSlot {
  if (typeof entry.fill !== 'string' || entry.fill.length === 0) {
    throw new TypeError(`style[${classByte}].fill must be a non-empty CSS color`)
  }
  if (typeof entry.stroke !== 'string' || entry.stroke.length === 0) {
    throw new TypeError(`style[${classByte}].stroke must be a non-empty CSS color`)
  }
  if (!Number.isFinite(entry.radius) || entry.radius <= 0) {
    throw new RangeError(`style[${classByte}].radius must be a finite number > 0`)
  }
  if (!Number.isFinite(entry.order)) {
    throw new RangeError(`style[${classByte}].order must be a finite number`)
  }
  const strokeWidth = entry.strokeWidth ?? DEFAULT_STROKE_WIDTH
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) {
    throw new RangeError(`style[${classByte}].strokeWidth must be a finite number >= 0`)
  }
  return {
    fill: entry.fill,
    order: entry.order,
    radius: entry.radius,
    stroke: entry.stroke,
    strokeWidth,
  }
}

function sameLook(left: PointLayerStyleSlot, right: PointLayerStyleSlot): boolean {
  return left.fill === right.fill && left.stroke === right.stroke
}

function reachPixels(radius: number, strokeWidth: number): number {
  return radius + strokeWidth / 2
}

function buildCenterIndex(
  worldX: Float64Array,
  worldY: Float64Array,
  zoom: number,
): Map<string, Uint32Array> {
  const n = 1 << zoom
  const buckets = new Map<string, number[]>()
  for (let index = 0; index < worldX.length; index += 1) {
    const tileX = wrapTile(Math.floor((worldX[index] ?? 0) * n), n)
    const tileY = clampTile(Math.floor((worldY[index] ?? 0) * n), n)
    const key = tileKey(tileX, tileY)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(index)
    else buckets.set(key, [index])
  }
  const packed = new Map<string, Uint32Array>()
  for (const [key, bucket] of buckets) packed.set(key, Uint32Array.from(bucket))
  return packed
}

function neighbourTiles(
  worldX: number,
  worldY: number,
  zoom: number,
  reachPx: number,
  tileSize: number,
): Array<{ x: number; y: number }> {
  const n = 1 << zoom
  const tileX = wrapTile(Math.floor(worldX * n), n)
  const tileY = clampTile(Math.floor(worldY * n), n)
  return neighbourTilesForTile(tileX, tileY, zoom, reachPx, tileSize)
}

function neighbourTilesForTile(
  tileX: number,
  tileY: number,
  zoom: number,
  reachPx: number,
  tileSize: number,
): Array<{ x: number; y: number }> {
  const n = 1 << zoom
  const halo = Math.max(1, Math.ceil(reachPx / tileSize))
  const tiles: Array<{ x: number; y: number }> = []
  for (let row = -halo; row <= halo; row += 1) {
    const y = tileY + row
    if (y < 0 || y >= n) continue
    for (let column = -halo; column <= halo; column += 1) {
      tiles.push({ x: wrapTile(tileX + column, n), y })
    }
  }
  return tiles
}

function pointReachesTile(
  worldX: number,
  worldY: number,
  tileX: number,
  tileY: number,
  n: number,
  reachPx: number,
  tileSize: number,
): boolean {
  const local = tileLocal(worldX, worldY, tileX, tileY, n)
  const closestX = clamp(local.x, 0, 1)
  const closestY = clamp(local.y, 0, 1)
  const distancePx = Math.hypot(local.x - closestX, local.y - closestY) * tileSize
  return distancePx <= reachPx
}

function tileLocal(
  worldX: number,
  worldY: number,
  tileX: number,
  tileY: number,
  n: number,
): { x: number; y: number } {
  let x = worldX * n - tileX
  if (x > n / 2) x -= n
  if (x < -n / 2) x += n
  return { x, y: worldY * n - tileY }
}

function orderIndexes(
  indexes: ArrayLike<number>,
  classes: Uint8Array,
  style: StyleSlots,
): number[] {
  const ordered: number[] = []
  for (let cursor = 0; cursor < indexes.length; cursor += 1) {
    const index = indexes[cursor]
    if (index === undefined) continue
    if (!style[classes[index] ?? -1]) continue
    ordered.push(index)
  }
  ordered.sort((left, right) => {
    const leftOrder = style[classes[left] ?? -1]?.order ?? Number.NEGATIVE_INFINITY
    const rightOrder = style[classes[right] ?? -1]?.order ?? Number.NEGATIVE_INFINITY
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left - right
  })
  return ordered
}

function wrapDelta(from: number, to: number): number {
  let delta = from - to
  if (delta > 0.5) delta -= 1
  if (delta < -0.5) delta += 1
  return delta
}

function wrapTile(value: number, n: number): number {
  return ((value % n) + n) % n
}

function clampTile(value: number, n: number): number {
  if (n <= 0) return 0
  return Math.min(n - 1, Math.max(0, value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function tileKey(x: number, y: number): string {
  return `${x}/${y}`
}
