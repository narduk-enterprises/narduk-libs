/**
 * The worker half of the decode protocol.
 *
 * An app's worker script is three lines: import this, import a decoder, serve.
 * Keeping the script in the app rather than publishing one means the bundler
 * that owns the app owns the worker chunk too, which is the only arrangement
 * Vite, webpack and Nuxt all agree on.
 *
 * ```ts
 * // app/workers/river-network.ts
 * import { createMvtDecoder, serveVectorTileDecoder } from '@narduk-enterprises/narduk-mapkit/vector-tiles'
 *
 * serveVectorTileDecoder(self, createMvtDecoder({ layers: ['reaches'], properties: ['ri', 'si', 'so'] }))
 * ```
 */
import {
  VECTOR_TILE_PAINT_CHANNEL,
  VECTOR_TILE_PAINT_STYLE_HISTORY,
} from '../client/vector-tile-paint-worker.js'
import {
  receiveVectorTile,
  sendVectorTile,
  VECTOR_TILE_DECODE_CHANNEL,
} from '../client/vector-tile-worker.js'
import {
  DecodedVectorTileCache,
  paintVectorTile,
  type DecodedVectorTile,
  type VectorTileCanvas,
  type VectorTileDecoder,
  type VectorTileOverlayStyle,
} from '../client/vector-tiles.js'

import type {
  VectorTilePaintResponse,
  VectorTilePaintUnavailableReason,
  VectorTilePaintWorkerRequest,
  VectorTileStyleFactories,
  VectorTileStyleSpec,
} from '../client/vector-tile-paint-worker.js'
import type {
  VectorTileDecodeRequest,
  VectorTileDecodeResponse,
} from '../client/vector-tile-worker.js'

/** The part of a worker's global scope this module uses. */
export interface VectorTileWorkerScope {
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  removeEventListener?: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

function isDecodeRequest(data: unknown): data is VectorTileDecodeRequest {
  if (typeof data !== 'object' || data === null) return false
  const message = data as Partial<VectorTileDecodeRequest>
  return (
    message.channel === VECTOR_TILE_DECODE_CHANNEL &&
    typeof message.id === 'number' &&
    message.bytes instanceof ArrayBuffer
  )
}

/**
 * Host {@link VECTOR_TILE_DECODE_CHANNEL} on a worker scope.
 *
 * Every reply carries the request id, so one worker can serve a screenful of
 * tiles at once. A decode that throws is reported as a message rather than as
 * an unhandled rejection, so the main thread fails that one tile and the map
 * keeps drawing. Returns a function that stops serving.
 */
export function serveVectorTileDecoder(
  scope: VectorTileWorkerScope,
  decode: VectorTileDecoder,
): () => void {
  const onMessage = (event: { data: unknown }) => {
    if (!isDecodeRequest(event.data)) return
    const { bytes, id, x, y, z } = event.data
    void respond(scope, id, decode, new Uint8Array(bytes), { x, y, z }, null)
  }

  scope.addEventListener('message', onMessage)
  return () => {
    scope.removeEventListener?.('message', onMessage)
  }
}

async function respond(
  scope: VectorTileWorkerScope,
  id: number,
  decode: VectorTileDecoder,
  bytes: Uint8Array,
  address: { x: number; y: number; z: number },
  retain: ((tile: DecodedVectorTile) => void) | null,
) {
  try {
    const decoded = await decode(bytes, address)
    let tile = decoded
    if (decoded && retain) {
      // The worker keeps the original; the main thread gets a copy, because a
      // transfer would detach the very buffers the painter is about to read.
      retain(decoded)
      tile = copyVectorTile(decoded)
    }
    if (!tile) {
      const empty: VectorTileDecodeResponse = {
        channel: VECTOR_TILE_DECODE_CHANNEL,
        id,
        tile: null,
      }
      scope.postMessage(empty)
      return
    }
    const { message, transfer } = sendVectorTile(tile)
    const response: VectorTileDecodeResponse = {
      channel: VECTOR_TILE_DECODE_CHANNEL,
      id,
      tile: message,
    }
    scope.postMessage(response, transfer)
  } catch (reason) {
    const failed: VectorTileDecodeResponse = {
      channel: VECTOR_TILE_DECODE_CHANNEL,
      error: reason instanceof Error ? reason.message : String(reason),
      id,
    }
    scope.postMessage(failed)
  }
}

/** The same tile over fresh buffers, so one copy can be transferred and the other kept. */
export function copyVectorTile(tile: DecodedVectorTile): DecodedVectorTile {
  return {
    coordinates: tile.coordinates.slice(),
    extent: tile.extent,
    featureLines: tile.featureLines.slice(),
    lineStarts: tile.lineStarts.slice(),
    properties: tile.properties,
    ...(tile.ri ? { ri: tile.ri.slice() } : {}),
    ...(tile.si ? { si: tile.si.slice() } : {}),
    ...(tile.so ? { so: tile.so.slice() } : {}),
  }
}

/** A canvas the worker can paint and then hand over as an `ImageBitmap`. */
export interface VectorTileWorkerCanvas extends VectorTileCanvas {
  transferToImageBitmap: () => ImageBitmap
}

export interface VectorTileWorkerOptions {
  /** Byte budget for the tiles the worker keeps to paint. Default 32 MiB. */
  cacheBytes?: number
  /** Count cap for the same, default 128. */
  cacheSize?: number
  /**
   * Make a canvas to paint on. Default `new OffscreenCanvas(width, height)`
   * where the worker has one; without it every paint is answered
   * `unavailable: 'canvas'` and the main thread paints.
   */
  createCanvas?: ((width: number, height: number) => VectorTileWorkerCanvas) | null
  decode: VectorTileDecoder
  /**
   * The factories `portableVectorTileStyle` names, by the same names. Import
   * them from the module the main thread builds its style with, so both
   * threads run one function.
   */
  styles?: VectorTileStyleFactories
}

/** Default byte budget for the tiles a paint worker keeps. */
export const DEFAULT_VECTOR_TILE_WORKER_CACHE_BYTES = 32 * 1024 * 1024

function isPaintWorkerRequest(data: unknown): data is VectorTilePaintWorkerRequest {
  if (typeof data !== 'object' || data === null) return false
  const message = data as Partial<VectorTilePaintWorkerRequest>
  return message.channel === VECTOR_TILE_PAINT_CHANNEL
}

function defaultCreateCanvas(): ((width: number, height: number) => VectorTileWorkerCanvas) | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  return (width, height) => new OffscreenCanvas(width, height) as unknown as VectorTileWorkerCanvas
}

/**
 * Host decode and paint on one worker scope.
 *
 * Decode requests are served as {@link serveVectorTileDecoder} serves them,
 * and a request with `retainAs` also keeps the tile here. Paint requests draw
 * a kept tile on an `OffscreenCanvas` with the same `paintVectorTile` the main
 * thread uses, and transfer the result back as an `ImageBitmap`. A paint that
 * cannot be done here (no canvas, an unknown style, a tile this worker no
 * longer has) is answered `unavailable` rather than failed, and the main
 * thread paints it. Returns a function that stops serving.
 *
 * ```ts
 * // app/workers/river-network.ts
 * import { createMvtDecoder, serveVectorTileWorker } from '@narduk-enterprises/narduk-mapkit/vector-tiles'
 * import { riverStyles } from '../utils/river-styles'
 *
 * serveVectorTileWorker(self, { decode: createMvtDecoder({ layers: ['rivers'] }), styles: riverStyles })
 * ```
 */
export function serveVectorTileWorker(
  scope: VectorTileWorkerScope,
  options: VectorTileWorkerOptions,
): () => void {
  const { decode, styles = {} } = options
  const createCanvas =
    options.createCanvas === undefined ? defaultCreateCanvas() : options.createCanvas
  const cache = new DecodedVectorTileCache(
    options.cacheSize ?? 128,
    options.cacheBytes ?? DEFAULT_VECTOR_TILE_WORKER_CACHE_BYTES,
  )
  const resolvedStyles = new Map<number, VectorTileOverlayStyle | null>()
  // One canvas per size: `transferToImageBitmap` leaves it blank and reusable.
  const canvases = new Map<number, VectorTileWorkerCanvas>()

  function resolveStyle(spec: VectorTileStyleSpec): VectorTileOverlayStyle | null {
    if (spec.kind === 'class') return spec.style
    const factory = styles[spec.name]
    if (!factory) return null
    return factory(spec.params as never)
  }

  function reply(message: Omit<VectorTilePaintResponse, 'channel'>, transfer?: Transferable[]) {
    const response: VectorTilePaintResponse = { channel: VECTOR_TILE_PAINT_CHANNEL, ...message }
    if (transfer) scope.postMessage(response, transfer)
    else scope.postMessage(response)
  }

  function unavailable(id: number, reason: VectorTilePaintUnavailableReason) {
    reply({ id, unavailable: reason })
  }

  function onPaintMessage(message: VectorTilePaintWorkerRequest) {
    if (message.type === 'style') {
      let style: VectorTileOverlayStyle | null
      try {
        style = resolveStyle(message.spec)
      } catch {
        style = null
      }
      resolvedStyles.set(message.styleId, style)
      while (resolvedStyles.size > VECTOR_TILE_PAINT_STYLE_HISTORY) {
        const oldest = resolvedStyles.keys().next().value
        if (oldest === undefined) break
        resolvedStyles.delete(oldest)
      }
      return
    }
    const { id } = message
    if (!createCanvas) {
      unavailable(id, 'canvas')
      return
    }
    const style = resolvedStyles.get(message.styleId)
    if (!style) {
      unavailable(id, 'style')
      return
    }
    let tile = cache.get(message.tileKey)
    if (!tile && message.tile) {
      tile = receiveVectorTile(message.tile)
      cache.set(message.tileKey, tile)
    }
    if (!tile) {
      unavailable(id, 'tile')
      return
    }
    try {
      const size = Math.round(message.tileSize * message.pixelRatio)
      let canvas = canvases.get(size)
      if (!canvas) {
        canvas = createCanvas(size, size)
        canvases.set(size, canvas)
      }
      const painted = paintVectorTile(canvas, tile, {
        pixelRatio: message.pixelRatio,
        style,
        tileSize: message.tileSize,
        zoom: message.zoom,
        ...(message.overzoom ? { overzoom: message.overzoom } : {}),
        ...(message.tileNetwork ? { tileNetwork: message.tileNetwork } : {}),
      })
      if (!painted) {
        reply({ bitmap: null, id })
        return
      }
      const bitmap = canvas.transferToImageBitmap()
      reply({ bitmap, id }, [bitmap])
    } catch (reason) {
      reply({ error: reason instanceof Error ? reason.message : String(reason), id })
    }
  }

  const onMessage = (event: { data: unknown }) => {
    const data = event.data
    if (isPaintWorkerRequest(data)) {
      onPaintMessage(data)
      return
    }
    if (!isDecodeRequest(data)) return
    const { bytes, id, retainAs, x, y, z } = data
    const retain =
      retainAs === undefined ? null : (tile: DecodedVectorTile) => cache.set(retainAs, tile)
    void respond(scope, id, decode, new Uint8Array(bytes), { x, y, z }, retain)
  }

  scope.addEventListener('message', onMessage)
  return () => {
    scope.removeEventListener?.('message', onMessage)
  }
}
