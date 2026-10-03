/**
 * Paint vector tiles off the main thread.
 *
 * Painting a dense river tile is tens of thousands of `lineTo` calls and then
 * the rasterization of every stroke, and MapKit asks for a screenful of tiles
 * at once. On a phone that is seconds of main-thread time while the page is
 * trying to become interactive. A worker can paint the same tile on an
 * `OffscreenCanvas` and transfer back an `ImageBitmap`, which the main thread
 * shows through a `bitmaprenderer` canvas: no copy, and MapKit draws it exactly
 * as it draws a canvas painted here.
 *
 * The worker keeps its own copy of the tiles it decoded (see `retainAs` in the
 * decode protocol), so a paint request names a tile rather than shipping it.
 * The main thread still holds the decoded tiles too: `hitTest` is synchronous
 * and must answer during a gesture.
 *
 * Styles cross the boundary as data. A class style is plain data already. A
 * style *function* cannot be posted, so an app wraps the function's inputs in
 * {@link portableVectorTileStyle}: the main thread posts the inputs, and the
 * worker rebuilds the same function from the same factory. A style that is
 * neither is painted on the main thread, exactly as before.
 *
 * This module is the main-thread half and stays protobuf-free; the worker half
 * is `serveVectorTileWorker` in the `./vector-tiles` entry.
 */
import { type VectorTileTransfer, type VectorTileWorkerPort, type WorkerVectorTileDecoder } from './vector-tile-worker.js';
import type { DecodedVectorTile, VectorTileClassStyle, VectorTileNetworkIdentity, VectorTileOverlayStyle, VectorTileOverzoom, VectorTilePainter } from './vector-tiles.js';
/** Message channel identifier, beside {@link VECTOR_TILE_DECODE_CHANNEL} on the same worker. */
export declare const VECTOR_TILE_PAINT_CHANNEL = "narduk-mapkit/vector-tile-paint";
/**
 * Builds a style from data. The same function runs on both threads: the main
 * thread to paint a tile the worker declined, the worker for everything else.
 */
export type VectorTileStyleFactory<TParams = never> = (params: TParams) => VectorTileOverlayStyle;
/** Factories by name, as the worker script registers them. */
export type VectorTileStyleFactories = Readonly<Record<string, (params: never) => VectorTileOverlayStyle>>;
/** A style as it crosses to the worker. */
export type VectorTileStyleSpec = {
    kind: 'class';
    style: VectorTileClassStyle;
} | {
    kind: 'factory';
    name: string;
    params: unknown;
};
export interface VectorTileStyleMessage {
    channel: typeof VECTOR_TILE_PAINT_CHANNEL;
    spec: VectorTileStyleSpec;
    styleId: number;
    type: 'style';
}
export interface VectorTilePaintMessage {
    channel: typeof VECTOR_TILE_PAINT_CHANNEL;
    id: number;
    overzoom?: VectorTileOverzoom;
    pixelRatio: number;
    styleId: number;
    /** Present when the worker does not hold the tile under `tileKey` yet. */
    tile?: VectorTileTransfer;
    tileKey: string;
    tileNetwork?: VectorTileNetworkIdentity;
    tileSize: number;
    type: 'paint';
    zoom: number;
}
export type VectorTilePaintWorkerRequest = VectorTilePaintMessage | VectorTileStyleMessage;
/** Why a worker could not paint a request. */
export type VectorTilePaintUnavailableReason = 'canvas' | 'style' | 'tile';
export interface VectorTilePaintResponse {
    /** `null` is a tile with nothing to draw at this zoom, which is not a failure. */
    bitmap?: ImageBitmap | null;
    channel: typeof VECTOR_TILE_PAINT_CHANNEL;
    error?: string;
    id: number;
    unavailable?: VectorTilePaintUnavailableReason;
}
/**
 * Build a style from `factory(params)` and remember how, so a worker painter
 * can rebuild it on the other side from the factory registered under `name`.
 *
 * `params` must survive `structuredClone` (strings, numbers, arrays, typed
 * arrays, plain objects). The returned style is an ordinary style: without a
 * worker painter it paints on the main thread unchanged.
 */
export declare function portableVectorTileStyle<TParams>(name: string, params: TParams, factory: VectorTileStyleFactory<TParams>): VectorTileOverlayStyle;
/** How a style crosses to a worker, or `null` when it cannot. */
export declare function vectorTileStyleSpec(style: VectorTileOverlayStyle): VectorTileStyleSpec | null;
/**
 * Show an `ImageBitmap` through a canvas, for a consumer that only takes a
 * canvas. A `bitmaprenderer` context takes ownership of the bitmap without
 * copying it.
 */
export declare function imageBitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement;
/**
 * Styles the worker remembers. A paint naming an older one is answered
 * `unavailable: 'style'` and painted on the main thread.
 */
export declare const VECTOR_TILE_PAINT_STYLE_HISTORY = 8;
export interface WorkerPainterOptions<TImage> {
    /**
     * Paint in the worker at all. Default: whether this thread has
     * `OffscreenCanvas`, which is the best available guess for the worker's.
     * When the worker turns out to lack it, it says so once and every later
     * tile is painted on the main thread.
     */
    enabled?: boolean;
    /** Cancel handle factory for the reply deadline. Injected so a test drives the clock. */
    scheduleTimeout?: (run: () => void, milliseconds: number) => () => void;
    /**
     * How long to wait for a painted tile before painting it on the main thread
     * instead. Long, because a phone painting a screenful queues every tile
     * behind the others.
     */
    timeoutMs?: number;
    /**
     * Turn the worker's `ImageBitmap` into what the map takes. Default
     * {@link imageBitmapToCanvas}: MapKit JS 6 accepts a bitmap, but draws its
     * translucent pixels darker than the same pixels in a canvas (measured on
     * River Status /map, narduk-libs PR for riverstatus#315), so a canvas is the
     * only image that matches main-thread painting. Pass `(bitmap) => bitmap`
     * for a consumer that handles premultiplied bitmaps correctly.
     */
    toImage?: (bitmap: ImageBitmap) => TImage;
    worker: VectorTileWorkerPort;
}
export interface WorkerVectorTilePainter<TImage> extends VectorTilePainter<TImage> {
    /** Fail every paint in flight (the overlay paints them on the main thread) and stop listening. */
    dispose: () => void;
    /** Paints waiting on the worker right now. */
    readonly pending: number;
    /** Record that the worker holds `tile` under `key`; the decoder's `retain` hook. */
    retain: (tile: DecodedVectorTile, key: string) => void;
}
/**
 * Talk to a worker that hosts {@link VECTOR_TILE_PAINT_CHANNEL}.
 *
 * Returns `null` from `paint`, synchronously, for anything it knows the worker
 * cannot take, so the overlay paints those on the main thread without a round
 * trip. Everything else resolves the worker's bitmap.
 */
export declare function createWorkerPainter<TImage = HTMLCanvasElement>(options: WorkerPainterOptions<TImage>): WorkerVectorTilePainter<TImage>;
export interface WorkerTileServiceOptions<TImage> extends Omit<WorkerPainterOptions<TImage>, 'scheduleTimeout' | 'timeoutMs'> {
    /** Reply deadline for a decode, as `createWorkerDecoder` takes it. */
    decodeTimeoutMs?: number;
    /** Reply deadline for a paint, as `createWorkerPainter` takes it. */
    paintTimeoutMs?: number;
    scheduleTimeout?: (run: () => void, milliseconds: number) => () => void;
}
export interface WorkerVectorTileService<TImage> {
    /** Pass as `decode` to `createVectorTileOverlaySource`. */
    decode: WorkerVectorTileDecoder['decode'];
    /** Stop both halves. Idempotent; does not terminate the worker, which the caller owns. */
    dispose: () => void;
    /** Pass as `painter` to `createVectorTileOverlaySource`. */
    painter: WorkerVectorTilePainter<TImage>;
}
/**
 * Decode and paint in one worker that hosts `serveVectorTileWorker`.
 *
 * The decoder asks the worker to keep each tile it decodes and tells the
 * painter the key, so painting a tile sends a few numbers, not the tile.
 */
export declare function createWorkerTileService<TImage = HTMLCanvasElement>(options: WorkerTileServiceOptions<TImage>): WorkerVectorTileService<TImage>;
//# sourceMappingURL=vector-tile-paint-worker.d.ts.map