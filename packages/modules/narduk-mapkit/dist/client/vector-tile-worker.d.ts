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
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
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
     * Transfer the tile bytes to the worker instead of copying them. The caller
     * must not reuse the array afterwards; it is detached. Default `true`,
     * because the bytes come straight from a tile read and are used once.
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
/** Rebuild the typed-array views over the buffers the worker transferred. */
export declare function receiveVectorTile(transfer: VectorTileTransfer): DecodedVectorTile;
/** Views onto the buffers to hand `postMessage`, so nothing is copied. */
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