import { type DecodedVectorTile, type VectorTileCanvas, type VectorTileDecoder } from '../client/vector-tiles.js';
import type { VectorTileStyleFactories } from '../client/vector-tile-paint-worker.js';
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
/** The same tile over fresh buffers, so one copy can be transferred and the other kept. */
export declare function copyVectorTile(tile: DecodedVectorTile): DecodedVectorTile;
/** A canvas the worker can paint and then hand over as an `ImageBitmap`. */
export interface VectorTileWorkerCanvas extends VectorTileCanvas {
    transferToImageBitmap: () => ImageBitmap;
}
export interface VectorTileWorkerOptions {
    /** Byte budget for the tiles the worker keeps to paint. Default 32 MiB. */
    cacheBytes?: number;
    /** Count cap for the same, default 128. */
    cacheSize?: number;
    /**
     * Make a canvas to paint on. Default `new OffscreenCanvas(width, height)`
     * where the worker has one; without it every paint is answered
     * `unavailable: 'canvas'` and the main thread paints.
     */
    createCanvas?: ((width: number, height: number) => VectorTileWorkerCanvas) | null;
    decode: VectorTileDecoder;
    /**
     * The factories `portableVectorTileStyle` names, by the same names. Import
     * them from the module the main thread builds its style with, so both
     * threads run one function.
     */
    styles?: VectorTileStyleFactories;
}
/** Default byte budget for the tiles a paint worker keeps. */
export declare const DEFAULT_VECTOR_TILE_WORKER_CACHE_BYTES: number;
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
export declare function serveVectorTileWorker(scope: VectorTileWorkerScope, options: VectorTileWorkerOptions): () => void;
//# sourceMappingURL=serve.d.ts.map