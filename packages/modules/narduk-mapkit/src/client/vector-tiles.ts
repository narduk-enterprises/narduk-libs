/**
 * Draw vector tiles onto MapKit through the async tile overlay.
 *
 * MapKit JS has no vector tile support: an overlay hands back an image per
 * tile. So this paints each tile to a canvas and returns it, which keeps a
 * dense network (millions of line features) off MapKit's own overlay list.
 *
 * The decode step is injected. That keeps this module free of protobuf
 * dependencies, lets an app run the decoder in a worker, and lets a test paint
 * fixture geometry without building a tile. Decoded tiles are cached, so
 * changing the style repaints from memory and never refetches.
 */

/** A decoded feature's properties, as a vector tile carries them. */
export type VectorTileProperties = Record<string, boolean | number | string | null>

/**
 * A decoded tile, stored columnar rather than as objects.
 *
 * A tile of flowlines carries on the order of 10^5 points. One `{ x, y }`
 * object per point costs roughly 40 bytes once V8 has its header and pointer,
 * so the default 256-tile cache would retain about a gigabyte -- past what
 * mobile Safari gives a tab before it discards it. The same points in an
 * `Int16Array` cost 4 bytes, which is the difference between a cache that
 * survives a pan across the country and one that doesn't.
 *
 * Build one with {@link buildDecodedVectorTile} rather than by hand.
 */
export interface DecodedVectorTile {
  /**
   * Interleaved `x, y` pairs for every line in the tile, in tile-local
   * coordinates. `Int16Array` because a tile's own space is `0..extent` (4096
   * in every tile this library has seen) and a clip buffer adds a fraction of
   * that; see {@link buildDecodedVectorTile} for what happens further out.
   */
  coordinates: Int16Array
  /** Tile-local coordinate space, 4096 in every tile this library has seen. */
  extent: number
  /**
   * Where each feature's lines begin, as an index into `lineStarts`. Feature
   * `f` owns lines `featureLines[f]` up to `featureLines[f + 1]`, so the length
   * is one more than the feature count.
   */
  featureLines: Uint32Array
  /**
   * Where each line begins, as a *point* index into `coordinates`. Line `l`
   * runs from point `lineStarts[l]` up to `lineStarts[l + 1]`, so the length is
   * one more than the line count.
   */
  lineStarts: Uint32Array
  /** One entry per feature, in the order `featureLines` indexes them. */
  properties: readonly VectorTileProperties[]
}

/** A feature as a caller describes it, before it is packed into flat arrays. */
export interface VectorTileFeatureInput {
  /** One entry per line; each is a run of tile-local points. */
  lines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
  properties: VectorTileProperties
}

/** Int16 range, the bound {@link buildDecodedVectorTile} clamps coordinates to. */
const COORDINATE_MIN = -32_768
const COORDINATE_MAX = 32_767

/**
 * Pack features into the columnar layout {@link DecodedVectorTile} holds.
 *
 * Coordinates are clamped into the `Int16Array` range. In a tile whose extent
 * is 4096 that bound is eight tile widths away from the tile, so a clamped
 * point is far outside the canvas either way and the clamp cannot change a
 * pixel -- it only stops a wildly out-of-range producer from wrapping a line
 * back across the tile.
 *
 * A line of fewer than two points is dropped: it can't be stroked, and keeping
 * it would put empty ranges in `lineStarts` for the painter to skip.
 */
export function buildDecodedVectorTile(
  extent: number,
  features: readonly VectorTileFeatureInput[],
): DecodedVectorTile {
  let pointCount = 0
  let lineCount = 0
  for (const feature of features) {
    for (const line of feature.lines) {
      if (line.length < 2) continue
      lineCount += 1
      pointCount += line.length
    }
  }

  const coordinates = new Int16Array(pointCount * 2)
  const lineStarts = new Uint32Array(lineCount + 1)
  const featureLines = new Uint32Array(features.length + 1)
  const properties: VectorTileProperties[] = []

  let pointIndex = 0
  let lineIndex = 0
  let featureIndex = 0
  for (const feature of features) {
    featureLines[featureIndex] = lineIndex
    for (const line of feature.lines) {
      if (line.length < 2) continue
      lineStarts[lineIndex] = pointIndex
      lineIndex += 1
      for (const point of line) {
        coordinates[pointIndex * 2] = clampCoordinate(point.x)
        coordinates[pointIndex * 2 + 1] = clampCoordinate(point.y)
        pointIndex += 1
      }
    }
    properties.push(feature.properties)
    featureIndex += 1
  }
  lineStarts[lineIndex] = pointIndex
  featureLines[featureIndex] = lineIndex

  return { coordinates, extent, featureLines, lineStarts, properties }
}

function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(COORDINATE_MAX, Math.max(COORDINATE_MIN, Math.round(value)))
}

/** Features in a decoded tile, which is one less than `featureLines.length`. */
export function vectorTileFeatureCount(tile: DecodedVectorTile): number {
  return Math.max(0, tile.featureLines.length - 1)
}

/** How a feature is painted, or `null` to skip it at this zoom. */
export interface VectorTileStyle {
  color: string
  /** Line width in CSS pixels, before the device pixel ratio. */
  width: number
  opacity?: number
}

export type VectorTileStyleFunction = (
  properties: VectorTileProperties,
  zoom: number,
) => VectorTileStyle | null

/**
 * Turn tile bytes into geometry.
 *
 * Return `null` for a tile that holds nothing to draw -- the same class of
 * answer as an archive with no tile at that address, and not a failure, so it
 * is not reported to `onError`. A tile that is present but malformed should
 * throw instead; that is what a caller wants counted.
 */
export type VectorTileDecoder = (
  bytes: Uint8Array,
  tile: { x: number; y: number; z: number },
) => Promise<DecodedVectorTile | null>

/** The 2D canvas surface the painter needs, narrowed to what it calls. */
export interface VectorTileCanvas {
  height: number
  width: number
  getContext: (contextId: '2d') => VectorTileCanvasContext | null
}

export interface VectorTileCanvasContext {
  lineCap: string
  lineJoin: string
  lineWidth: number
  strokeStyle: string
  globalAlpha: number
  beginPath: () => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  lineTo: (x: number, y: number) => void
  moveTo: (x: number, y: number) => void
  stroke: () => void
}

export interface VectorTileOverlaySourceOptions<TCanvas extends VectorTileCanvas> {
  /** Decoded-tile cache size. Tiles are small; the default covers a few screens. */
  cacheSize?: number
  createCanvas: (width: number, height: number) => TCanvas
  decode: VectorTileDecoder
  /** Reported per tile; the tile itself resolves to `null` and draws nothing. */
  onError?: (reason: unknown) => void
  style: VectorTileStyleFunction
  tileBytes: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Uint8Array | null>
  /** Logical tile size before `scale`. MapKit asks for 256 or 512. */
  tileSize?: number
}

export interface VectorTileOverlaySource<TCanvas extends VectorTileCanvas> {
  /** Retained coordinate, index and property bytes, for a memory budget. */
  readonly cacheBytes: number
  /** Drop every decoded tile, for example when the archive is replaced. */
  clearCache: () => void
  /** Pass to `createMapKitAsyncTileOverlay` or a `MapKitAsyncLayerDescriptor`. */
  imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>
  /** Decoded tiles held right now. */
  readonly size: number
  /**
   * Swap the style. Cached tiles repaint on the next request without a
   * refetch or a re-decode, which is what makes a lens change fast.
   */
  setStyle: (style: VectorTileStyleFunction) => void
}

/** Bytes a decoded tile retains, counting its arrays rather than its properties. */
export function decodedVectorTileBytes(tile: DecodedVectorTile): number {
  return tile.coordinates.byteLength + tile.lineStarts.byteLength + tile.featureLines.byteLength
}

/** Smallest LRU that does the job: Map preserves insertion order. */
class TileCache {
  readonly #limit: number
  readonly #tiles = new Map<string, DecodedVectorTile>()
  #bytes = 0

  constructor(limit: number) {
    this.#limit = Math.max(1, limit)
  }

  get bytes() {
    return this.#bytes
  }

  get size() {
    return this.#tiles.size
  }

  clear() {
    this.#tiles.clear()
    this.#bytes = 0
  }

  get(key: string) {
    const tile = this.#tiles.get(key)
    if (!tile) return null
    this.#tiles.delete(key)
    this.#tiles.set(key, tile)
    return tile
  }

  set(key: string, tile: DecodedVectorTile) {
    this.#drop(key)
    this.#tiles.set(key, tile)
    this.#bytes += decodedVectorTileBytes(tile)
    while (this.#tiles.size > this.#limit) {
      const oldest = this.#tiles.keys().next().value
      if (oldest === undefined) break
      this.#drop(oldest)
    }
  }

  #drop(key: string) {
    const existing = this.#tiles.get(key)
    if (!existing) return
    this.#bytes -= decodedVectorTileBytes(existing)
    this.#tiles.delete(key)
  }
}

/**
 * Paint one decoded tile. Exported because the hit-test and the overlay need
 * the same tile-to-pixel mapping, and a test can call it directly.
 */
export function paintVectorTile(
  canvas: VectorTileCanvas,
  tile: DecodedVectorTile,
  options: { pixelRatio: number; style: VectorTileStyleFunction; tileSize: number; zoom: number },
): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { pixelRatio, style, tileSize, zoom } = options
  const scale = (tileSize * pixelRatio) / tile.extent
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const { coordinates, featureLines, lineStarts } = tile
  let painted = false
  for (let feature = 0; feature < featureLines.length - 1; feature += 1) {
    const properties = tile.properties[feature]
    if (!properties) continue
    const paint = style(properties, zoom)
    if (!paint) continue
    context.strokeStyle = paint.color
    context.lineWidth = Math.max(paint.width * pixelRatio, pixelRatio * 0.5)
    context.globalAlpha = paint.opacity ?? 1
    const lastLine = featureLines[feature + 1] ?? 0
    for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
      const start = lineStarts[line] ?? 0
      const end = lineStarts[line + 1] ?? start
      if (end - start < 2) continue
      context.beginPath()
      context.moveTo(
        (coordinates[start * 2] ?? 0) * scale,
        (coordinates[start * 2 + 1] ?? 0) * scale,
      )
      for (let point = start + 1; point < end; point += 1) {
        context.lineTo(
          (coordinates[point * 2] ?? 0) * scale,
          (coordinates[point * 2 + 1] ?? 0) * scale,
        )
      }
      context.stroke()
      painted = true
    }
  }
  context.globalAlpha = 1
  return painted
}

/**
 * Build the `imageForTile` function for a vector tile archive.
 *
 * An empty tile, a missing tile and a failed decode all resolve to `null`, so
 * MapKit draws nothing there instead of a blank square over the basemap.
 */
export function createVectorTileOverlaySource<TCanvas extends VectorTileCanvas>(
  options: VectorTileOverlaySourceOptions<TCanvas>,
): VectorTileOverlaySource<TCanvas> {
  const { cacheSize = 256, createCanvas, decode, onError, tileBytes, tileSize = 256 } = options
  const cache = new TileCache(cacheSize)
  let style = options.style

  async function decodedTile(z: number, x: number, y: number) {
    const key = `${z}/${x}/${y}`
    const cached = cache.get(key)
    if (cached) return cached
    const bytes = await tileBytes(z, x, y)
    if (!bytes) return null
    const tile = await decode(bytes, { x, y, z })
    if (!tile) return null
    cache.set(key, tile)
    return tile
  }

  return {
    get cacheBytes() {
      return cache.bytes
    },
    clearCache() {
      cache.clear()
    },
    async imageForTile(x, y, z, scale) {
      try {
        const tile = await decodedTile(z, x, y)
        if (!tile || vectorTileFeatureCount(tile) === 0) return null
        const pixelRatio = scale > 0 ? scale : 1
        const size = Math.round(tileSize * pixelRatio)
        const canvas = createCanvas(size, size)
        const painted = paintVectorTile(canvas, tile, {
          pixelRatio,
          style,
          tileSize,
          zoom: z,
        })
        return painted ? canvas : null
      } catch (reason) {
        onError?.(reason)
        return null
      }
    },
    get size() {
      return cache.size
    },
    setStyle(next) {
      style = next
    },
  }
}
