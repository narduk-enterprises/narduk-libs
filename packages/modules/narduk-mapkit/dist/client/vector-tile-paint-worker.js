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
import { createWorkerDecoder, sendVectorTile, } from './vector-tile-worker.js';
import { isVectorTileClassStyle, VectorTilePaintUnavailableError } from './vector-tiles.js';
/** Message channel identifier, beside {@link VECTOR_TILE_DECODE_CHANNEL} on the same worker. */
export const VECTOR_TILE_PAINT_CHANNEL = 'narduk-mapkit/vector-tile-paint';
const portableStyles = new WeakMap();
/**
 * Build a style from `factory(params)` and remember how, so a worker painter
 * can rebuild it on the other side from the factory registered under `name`.
 *
 * `params` must survive `structuredClone` (strings, numbers, arrays, typed
 * arrays, plain objects). The returned style is an ordinary style: without a
 * worker painter it paints on the main thread unchanged.
 */
export function portableVectorTileStyle(name, params, factory) {
    const style = factory(params);
    portableStyles.set(style, { name, params });
    return style;
}
/** How a style crosses to a worker, or `null` when it cannot. */
export function vectorTileStyleSpec(style) {
    const portable = portableStyles.get(style);
    if (portable)
        return { kind: 'factory', name: portable.name, params: portable.params };
    if (isVectorTileClassStyle(style))
        return { kind: 'class', style };
    return null;
}
/**
 * Show an `ImageBitmap` through a canvas, for a consumer that only takes a
 * canvas. A `bitmaprenderer` context takes ownership of the bitmap without
 * copying it.
 */
export function imageBitmapToCanvas(bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const renderer = canvas.getContext('bitmaprenderer');
    if (renderer)
        renderer.transferFromImageBitmap(bitmap);
    else
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    return canvas;
}
function isPaintResponse(data) {
    if (typeof data !== 'object' || data === null)
        return false;
    const message = data;
    return message.channel === VECTOR_TILE_PAINT_CHANNEL && typeof message.id === 'number';
}
function defaultScheduleTimeout(run, milliseconds) {
    const handle = setTimeout(run, milliseconds);
    return () => {
        clearTimeout(handle);
    };
}
/**
 * Styles the worker remembers. A paint naming an older one is answered
 * `unavailable: 'style'` and painted on the main thread.
 */
export const VECTOR_TILE_PAINT_STYLE_HISTORY = 8;
/**
 * Talk to a worker that hosts {@link VECTOR_TILE_PAINT_CHANNEL}.
 *
 * Returns `null` from `paint`, synchronously, for anything it knows the worker
 * cannot take, so the overlay paints those on the main thread without a round
 * trip. Everything else resolves the worker's bitmap.
 */
export function createWorkerPainter(options) {
    const { scheduleTimeout = defaultScheduleTimeout, timeoutMs = 30_000, toImage = (bitmap) => imageBitmapToCanvas(bitmap), worker, } = options;
    let enabled = options.enabled ?? typeof OffscreenCanvas !== 'undefined';
    const waiting = new Map();
    const tileKeys = new WeakMap();
    const styleIds = new WeakMap();
    const unpaintableStyles = new Set();
    let nextId = 1;
    let nextStyleId = 1;
    let nextTileKey = 1;
    let disposed = false;
    function settle(id) {
        const entry = waiting.get(id);
        if (!entry)
            return null;
        waiting.delete(id);
        entry.cancelTimeout();
        return entry;
    }
    function post(message) {
        worker.postMessage(message);
    }
    /** The id the worker knows this style by, posting it first if it is new. `null`: not portable. */
    function styleIdFor(style) {
        const known = styleIds.get(style);
        if (known !== undefined)
            return unpaintableStyles.has(known) ? null : known;
        const spec = vectorTileStyleSpec(style);
        if (!spec)
            return null;
        const styleId = nextStyleId;
        nextStyleId += 1;
        styleIds.set(style, styleId);
        post({ channel: VECTOR_TILE_PAINT_CHANNEL, spec, styleId, type: 'style' });
        return styleId;
    }
    function unavailable(reason) {
        return new VectorTilePaintUnavailableError(`vector tile worker painter: ${reason}`);
    }
    const onMessage = (event) => {
        if (!isPaintResponse(event.data))
            return;
        const response = event.data;
        const entry = settle(response.id);
        if (!entry)
            return;
        if (response.unavailable === 'tile' && entry.resend) {
            // The worker evicted the tile, or never had it: send it once, copied,
            // because the main thread's cache still owns these buffers.
            send(entry.tile, { ...entry.message, tile: sendVectorTile(entry.tile).message }, entry);
            return;
        }
        if (response.unavailable !== undefined) {
            if (response.unavailable === 'canvas')
                enabled = false;
            if (response.unavailable === 'style')
                unpaintableStyles.add(entry.message.styleId);
            entry.reject(unavailable(`worker could not paint (${response.unavailable})`));
            return;
        }
        if (response.error !== undefined) {
            entry.reject(new Error(response.error));
            return;
        }
        const bitmap = response.bitmap ?? null;
        try {
            entry.resolve(bitmap ? toImage(bitmap) : null);
        }
        catch (reason) {
            // A bitmap the page cannot show is still a tile the main thread can paint.
            entry.reject(unavailable(reason instanceof Error ? reason.message : String(reason)));
        }
    };
    function send(tile, message, previous) {
        const cancelTimeout = scheduleTimeout(() => {
            settle(message.id)?.reject(unavailable(`no reply after ${timeoutMs}ms`));
        }, timeoutMs);
        waiting.set(message.id, {
            cancelTimeout,
            message,
            reject: previous.reject,
            // Only the first attempt may resend; a worker that loses a tile it was
            // just handed is not going to keep the second copy either.
            resend: message.tile === undefined,
            resolve: previous.resolve,
            tile,
        });
        try {
            post(message);
        }
        catch (reason) {
            settle(message.id)?.reject(unavailable(reason instanceof Error ? reason.message : String(reason)));
        }
    }
    worker.addEventListener('message', onMessage);
    return {
        dispose() {
            if (disposed)
                return;
            disposed = true;
            worker.removeEventListener?.('message', onMessage);
            for (const id of [...waiting.keys()])
                settle(id)?.reject(unavailable('disposed'));
        },
        paint(tile, request) {
            if (disposed || !enabled)
                return null;
            const styleId = styleIdFor(request.style);
            if (styleId === null)
                return null;
            let tileKey = tileKeys.get(tile);
            const known = tileKey !== undefined;
            if (tileKey === undefined) {
                tileKey = `p${nextTileKey}`;
                nextTileKey += 1;
                tileKeys.set(tile, tileKey);
            }
            const id = nextId;
            nextId += 1;
            const message = {
                channel: VECTOR_TILE_PAINT_CHANNEL,
                id,
                pixelRatio: request.pixelRatio,
                styleId,
                tileKey,
                tileSize: request.tileSize,
                type: 'paint',
                zoom: request.zoom,
                ...(request.overzoom ? { overzoom: request.overzoom } : {}),
                ...(request.tileNetwork ? { tileNetwork: request.tileNetwork } : {}),
                // A tile the worker did not decode travels with its first paint.
                ...(known ? {} : { tile: sendVectorTile(tile).message }),
            };
            return new Promise((resolve, reject) => {
                send(tile, message, { reject, resolve });
            });
        },
        get pending() {
            return waiting.size;
        },
        retain(tile, key) {
            tileKeys.set(tile, key);
        },
    };
}
/**
 * Decode and paint in one worker that hosts `serveVectorTileWorker`.
 *
 * The decoder asks the worker to keep each tile it decodes and tells the
 * painter the key, so painting a tile sends a few numbers, not the tile.
 */
export function createWorkerTileService(options) {
    const { decodeTimeoutMs, paintTimeoutMs, scheduleTimeout, worker, ...painterOptions } = options;
    const painter = createWorkerPainter({
        ...painterOptions,
        ...(scheduleTimeout ? { scheduleTimeout } : {}),
        ...(paintTimeoutMs === undefined ? {} : { timeoutMs: paintTimeoutMs }),
        worker,
    });
    const decoder = createWorkerDecoder({
        retain: painter.retain,
        ...(scheduleTimeout ? { scheduleTimeout } : {}),
        ...(decodeTimeoutMs === undefined ? {} : { timeoutMs: decodeTimeoutMs }),
        worker,
    });
    return {
        decode: decoder.decode,
        dispose() {
            decoder.dispose();
            painter.dispose();
        },
        painter,
    };
}
//# sourceMappingURL=vector-tile-paint-worker.js.map