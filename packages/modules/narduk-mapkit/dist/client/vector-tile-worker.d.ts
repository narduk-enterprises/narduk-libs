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
import type { DecodedVectorTile, VectorTileDecoder, VectorTileProperties } from './vector-tiles.js';
/** Message channel identifier, so a shared worker can host other protocols. */
export declare const VECTOR_TILE_DECODE_CHANNEL = "narduk-mapkit/vector-tile-decode";
export interface VectorTileDecodeRequest {
    bytes: ArrayBuffer;
    channel: typeof VECTOR_TILE_DECODE_CHANNEL;
    id: number;
    x: number;
    y: number;
    z: number;
}
/** A decoded tile on the wire: the typed arrays travel as their buffers. */
export interface VectorTileTransfer {
    coordinates: ArrayBuffer;
    extent: number;
    featureLines: ArrayBuffer;
    lineStarts: ArrayBuffer;
    properties: readonly VectorTileProperties[];
}
export interface VectorTileDecodeResponse {
    channel: typeof VECTOR_TILE_DECODE_CHANNEL;
    /** Present when the decode threw; the tile then resolves as a failure. */
    error?: string;
    id: number;
    /** `null` is a tile with nothing to draw, which is not a failure. */
    tile?: VectorTileTransfer | null;
}
/** The part of a `Worker` this module uses, so a test can supply a fake. */
export interface VectorTileWorkerPort {
    addEventListener: (type: 'message', listener: (event: {
        data: unknown;
    }) => void) => void;
    /**
     * Method syntax on purpose: a real `Worker`'s `postMessage` requires its
     * transfer list, and only bivariant parameter checking lets one satisfy a
     * port that can also be called without one.
     */
    postMessage(message: unknown, transfer?: Transferable[]): void;
    removeEventListener?: (type: 'message', listener: (event: {
        data: unknown;
    }) => void) => void;
}
export interface WorkerDecoderOptions {
    /**
     * Cancel handle factory for the reply deadline. Injected so a test drives
     * the clock; defaults to `setTimeout`/`clearTimeout`.
     */
    scheduleTimeout?: (run: () => void, milliseconds: number) => () => void;
    /**
     * How long to wait for a reply before failing the tile. A worker that dies
     * mid-decode never answers, and without this the promise -- and the tile --
     * would be pending for the life of the map.
     */
    timeoutMs?: number;
    /**
     * Transfer the tile bytes to the worker instead of copying them. A caller
     * must not reuse an array that was transferred; it is detached. Default
     * `true`, because the bytes come straight from a tile read and are used
     * once. A view that does not span its whole buffer is copied either way
     * (see {@link tightBuffer}), so only that array survives a transfer.
     */
    transfer?: boolean;
    worker: VectorTileWorkerPort;
}
export interface WorkerVectorTileDecoder {
    /** Pass as `decode` to `createVectorTileOverlaySource`. */
    decode: VectorTileDecoder;
    /** Fail every in-flight decode and stop listening. Idempotent. */
    dispose: () => void;
    /** Decodes waiting on the worker right now. */
    readonly pending: number;
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
export declare function tightBuffer(view: ArrayBufferView): ArrayBuffer;
/** Rebuild the typed-array views over the buffers the worker transferred. */
export declare function receiveVectorTile(transfer: VectorTileTransfer): DecodedVectorTile;
/**
 * The buffers to hand `postMessage`, alongside the transfer list.
 *
 * Nothing is copied for a tile built by `buildDecodedVectorTile`, whose arrays
 * each own their buffer. Only a pooled view pays for a copy.
 */
export declare function sendVectorTile(tile: DecodedVectorTile): {
    message: VectorTileTransfer;
    transfer: Transferable[];
};
/**
 * Talk to a worker that hosts {@link VECTOR_TILE_DECODE_CHANNEL}.
 *
 * Requests are correlated by id, so one worker serves every tile in flight.
 * A reply that never comes fails that tile alone rather than the overlay.
 */
export declare function createWorkerDecoder(options: WorkerDecoderOptions): WorkerVectorTileDecoder;
//# sourceMappingURL=vector-tile-worker.d.ts.map