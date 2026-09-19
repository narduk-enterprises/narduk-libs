/**
 * Run tile decoding off the main thread.
 *
 * Decoding a vector tile is protobuf parsing plus a zigzag-delta walk over
 * every point. On a national network that is tens of milliseconds per tile,
 * and MapKit asks for a screenful at once -- on the main thread that is a
 * visible stall in the middle of a pan.
 *
 * Only the main-thread half lives here, so `./client` stays free of protobuf
 * dependencies: this module speaks a small message protocol and knows nothing
 * about the format on the other end. The worker half, and the decoder it runs,
 * are in the `./vector-tiles` entry.
 */
import type { DecodedVectorTile, VectorTileDecoder, VectorTileProperties } from './vector-tiles.js'

/** Message channel identifier, so a shared worker can host other protocols. */
export const VECTOR_TILE_DECODE_CHANNEL = 'narduk-mapkit/vector-tile-decode'

export interface VectorTileDecodeRequest {
  bytes: ArrayBuffer
  channel: typeof VECTOR_TILE_DECODE_CHANNEL
  id: number
  x: number
  y: number
  z: number
}

/** A decoded tile on the wire: the typed arrays travel as their buffers. */
export interface VectorTileTransfer {
  coordinates: ArrayBuffer
  extent: number
  featureLines: ArrayBuffer
  lineStarts: ArrayBuffer
  properties: readonly VectorTileProperties[]
}

export interface VectorTileDecodeResponse {
  channel: typeof VECTOR_TILE_DECODE_CHANNEL
  /** Present when the decode threw; the tile then resolves as a failure. */
  error?: string
  id: number
  /** `null` is a tile with nothing to draw, which is not a failure. */
  tile?: VectorTileTransfer | null
}

/** The part of a `Worker` this module uses, so a test can supply a fake. */
export interface VectorTileWorkerPort {
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  removeEventListener?: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

export interface WorkerDecoderOptions {
  /**
   * Cancel handle factory for the reply deadline. Injected so a test drives
   * the clock; defaults to `setTimeout`/`clearTimeout`.
   */
  scheduleTimeout?: (run: () => void, milliseconds: number) => () => void
  /**
   * How long to wait for a reply before failing the tile. A worker that dies
   * mid-decode never answers, and without this the promise -- and the tile --
   * would be pending for the life of the map.
   */
  timeoutMs?: number
  /**
   * Transfer the tile bytes to the worker instead of copying them. A caller
   * must not reuse an array that was transferred; it is detached. Default
   * `true`, because the bytes come straight from a tile read and are used
   * once. A view that does not span its whole buffer is copied either way
   * (see {@link tightBuffer}), so only that array survives a transfer.
   */
  transfer?: boolean
  worker: VectorTileWorkerPort
}

export interface WorkerVectorTileDecoder {
  /** Pass as `decode` to `createVectorTileOverlaySource`. */
  decode: VectorTileDecoder
  /** Fail every in-flight decode and stop listening. Idempotent. */
  dispose: () => void
  /** Decodes waiting on the worker right now. */
  readonly pending: number
}

function defaultScheduleTimeout(run: () => void, milliseconds: number) {
  const handle = setTimeout(run, milliseconds)
  return () => {
    clearTimeout(handle)
  }
}

function isDecodeResponse(data: unknown): data is VectorTileDecodeResponse {
  if (typeof data !== 'object' || data === null) return false
  const message = data as Partial<VectorTileDecodeResponse>
  return message.channel === VECTOR_TILE_DECODE_CHANNEL && typeof message.id === 'number'
}

/**
 * The bytes of `view` as a buffer that holds nothing else.
 *
 * `view.buffer` is the whole allocation, which for a view produced by
 * `subarray`, a decompressor, or a pooled read is larger than the view and
 * starts before it. Posting that buffer would hand the worker the wrong bytes,
 * and transferring it would detach a buffer the caller still owns. A view that
 * already spans its buffer is passed through, so the common case stays free.
 */
export function tightBuffer(view: ArrayBufferView): ArrayBuffer {
  const buffer = view.buffer as ArrayBuffer
  if (view.byteOffset === 0 && view.byteLength === buffer.byteLength) return buffer
  return buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
}

/** Rebuild the typed-array views over the buffers the worker transferred. */
export function receiveVectorTile(transfer: VectorTileTransfer): DecodedVectorTile {
  return {
    coordinates: new Int16Array(transfer.coordinates),
    extent: transfer.extent,
    featureLines: new Uint32Array(transfer.featureLines),
    lineStarts: new Uint32Array(transfer.lineStarts),
    properties: transfer.properties,
  }
}

/**
 * The buffers to hand `postMessage`, alongside the transfer list.
 *
 * Nothing is copied for a tile built by `buildDecodedVectorTile`, whose arrays
 * each own their buffer. Only a pooled view pays for a copy.
 */
export function sendVectorTile(tile: DecodedVectorTile): {
  message: VectorTileTransfer
  transfer: Transferable[]
} {
  // Tight for the same reason the request bytes are: a decoder that builds
  // its arrays as views into a pool would otherwise ship the whole pool.
  const message: VectorTileTransfer = {
    coordinates: tightBuffer(tile.coordinates),
    extent: tile.extent,
    featureLines: tightBuffer(tile.featureLines),
    lineStarts: tightBuffer(tile.lineStarts),
    properties: tile.properties,
  }
  return { message, transfer: [message.coordinates, message.featureLines, message.lineStarts] }
}

/**
 * Talk to a worker that hosts {@link VECTOR_TILE_DECODE_CHANNEL}.
 *
 * Requests are correlated by id, so one worker serves every tile in flight.
 * A reply that never comes fails that tile alone rather than the overlay.
 */
export function createWorkerDecoder(options: WorkerDecoderOptions): WorkerVectorTileDecoder {
  const {
    scheduleTimeout = defaultScheduleTimeout,
    timeoutMs = 15_000,
    transfer = true,
    worker,
  } = options

  interface Waiting {
    cancelTimeout: () => void
    reject: (reason: Error) => void
    resolve: (tile: DecodedVectorTile | null) => void
  }

  const waiting = new Map<number, Waiting>()
  let nextId = 1
  let disposed = false

  function settle(id: number) {
    const entry = waiting.get(id)
    if (!entry) return null
    waiting.delete(id)
    entry.cancelTimeout()
    return entry
  }

  const onMessage = (event: { data: unknown }) => {
    if (!isDecodeResponse(event.data)) return
    const entry = settle(event.data.id)
    if (!entry) return
    if (event.data.error !== undefined) {
      entry.reject(new Error(event.data.error))
      return
    }
    const tile = event.data.tile
    entry.resolve(tile ? receiveVectorTile(tile) : null)
  }

  worker.addEventListener('message', onMessage)

  return {
    decode(bytes, tile) {
      if (disposed) return Promise.reject(new Error('vector tile worker decoder is disposed'))
      const id = nextId
      nextId += 1
      return new Promise<DecodedVectorTile | null>((resolve, reject) => {
        const cancelTimeout = scheduleTimeout(() => {
          const entry = settle(id)
          entry?.reject(new Error(`vector tile decode timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        waiting.set(id, { cancelTimeout, reject, resolve })
        const buffer = tightBuffer(bytes)
        const request: VectorTileDecodeRequest = {
          bytes: buffer,
          channel: VECTOR_TILE_DECODE_CHANNEL,
          id,
          x: tile.x,
          y: tile.y,
          z: tile.z,
        }
        try {
          worker.postMessage(request, transfer ? [buffer] : undefined)
        } catch (reason) {
          settle(id)?.reject(reason instanceof Error ? reason : new Error(String(reason)))
        }
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      worker.removeEventListener?.('message', onMessage)
      for (const id of [...waiting.keys()]) {
        settle(id)?.reject(new Error('vector tile worker decoder is disposed'))
      }
    },
    get pending() {
      return waiting.size
    },
  }
}
