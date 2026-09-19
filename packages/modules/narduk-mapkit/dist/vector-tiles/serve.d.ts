import type { VectorTileDecoder } from '../client/vector-tiles.js';
/** The part of a worker's global scope this module uses. */
export interface VectorTileWorkerScope {
    addEventListener: (type: 'message', listener: (event: {
        data: unknown;
    }) => void) => void;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
    removeEventListener?: (type: 'message', listener: (event: {
        data: unknown;
    }) => void) => void;
}
/**
 * Host {@link VECTOR_TILE_DECODE_CHANNEL} on a worker scope.
 *
 * Every reply carries the request id, so one worker can serve a screenful of
 * tiles at once. A decode that throws is reported as a message rather than as
 * an unhandled rejection, so the main thread fails that one tile and the map
 * keeps drawing. Returns a function that stops serving.
 */
export declare function serveVectorTileDecoder(scope: VectorTileWorkerScope, decode: VectorTileDecoder): () => void;
//# sourceMappingURL=serve.d.ts.map