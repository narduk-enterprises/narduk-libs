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

/** A ring or line, in tile-local coordinates (0..extent). */
export type VectorTileGeometry = ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>

export interface VectorTileFeature {
  geometry: VectorTileGeometry
  properties: VectorTileProperties
}

export interface DecodedVectorTile {
  /** Tile-local coordinate space, 4096 in every tile this library has seen. */
  extent: number
  features: readonly VectorTileFeature[]
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

/** Smallest LRU that does the job: Map preserves insertion order. */
class TileCache {
  readonly #limit: number
  readonly #tiles = new Map<string, DecodedVectorTile>()

  constructor(limit: number) {
    this.#limit = Math.max(1, limit)
  }

  get size() {
    return this.#tiles.size
  }

  clear() {
    this.#tiles.clear()
  }

  get(key: string) {
    const tile = this.#tiles.get(key)
    if (!tile) return null
    this.#tiles.delete(key)
    this.#tiles.set(key, tile)
    return tile
  }

  set(key: string, tile: DecodedVectorTile) {
    if (this.#tiles.has(key)) this.#tiles.delete(key)
    this.#tiles.set(key, tile)
    while (this.#tiles.size > this.#limit) {
      const oldest = this.#tiles.keys().next().value
      if (oldest === undefined) break
      this.#tiles.delete(oldest)
    }
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

  let painted = false
  for (const feature of tile.features) {
    const paint = style(feature.properties, zoom)
    if (!paint) continue
    context.strokeStyle = paint.color
    context.lineWidth = Math.max(paint.width * pixelRatio, pixelRatio * 0.5)
    context.globalAlpha = paint.opacity ?? 1
    for (const line of feature.geometry) {
      if (line.length < 2) continue
      context.beginPath()
      let first = true
      for (const point of line) {
        const x = point.x * scale
        const y = point.y * scale
        if (first) {
          context.moveTo(x, y)
          first = false
        } else {
          context.lineTo(x, y)
        }
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
    clearCache() {
      cache.clear()
    },
    async imageForTile(x, y, z, scale) {
      try {
        const tile = await decodedTile(z, x, y)
        if (!tile || tile.features.length === 0) return null
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
