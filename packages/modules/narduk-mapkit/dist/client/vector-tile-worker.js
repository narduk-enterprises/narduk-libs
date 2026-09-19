/** Message channel identifier, so a shared worker can host other protocols. */
export const VECTOR_TILE_DECODE_CHANNEL = 'narduk-mapkit/vector-tile-decode';
function defaultScheduleTimeout(run, milliseconds) {
    const handle = setTimeout(run, milliseconds);
    return () => {
        clearTimeout(handle);
    };
}
function isDecodeResponse(data) {
    if (typeof data !== 'object' || data === null)
        return false;
    const message = data;
    return message.channel === VECTOR_TILE_DECODE_CHANNEL && typeof message.id === 'number';
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
export function tightBuffer(view) {
    const buffer = view.buffer;
    if (view.byteOffset === 0 && view.byteLength === buffer.byteLength)
        return buffer;
    return buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
/** Rebuild the typed-array views over the buffers the worker transferred. */
export function receiveVectorTile(transfer) {
    return {
        coordinates: new Int16Array(transfer.coordinates),
        extent: transfer.extent,
        featureLines: new Uint32Array(transfer.featureLines),
        lineStarts: new Uint32Array(transfer.lineStarts),
        properties: transfer.properties,
    };
}
/**
 * The buffers to hand `postMessage`, alongside the transfer list.
 *
 * Nothing is copied for a tile built by `buildDecodedVectorTile`, whose arrays
 * each own their buffer. Only a pooled view pays for a copy.
 */
export function sendVectorTile(tile) {
    // Tight for the same reason the request bytes are: a decoder that builds
    // its arrays as views into a pool would otherwise ship the whole pool.
    const message = {
        coordinates: tightBuffer(tile.coordinates),
        extent: tile.extent,
        featureLines: tightBuffer(tile.featureLines),
        lineStarts: tightBuffer(tile.lineStarts),
        properties: tile.properties,
    };
    return { message, transfer: [message.coordinates, message.featureLines, message.lineStarts] };
}
/**
 * Talk to a worker that hosts {@link VECTOR_TILE_DECODE_CHANNEL}.
 *
 * Requests are correlated by id, so one worker serves every tile in flight.
 * A reply that never comes fails that tile alone rather than the overlay.
 */
export function createWorkerDecoder(options) {
    const { scheduleTimeout = defaultScheduleTimeout, timeoutMs = 15_000, transfer = true, worker, } = options;
    const waiting = new Map();
    let nextId = 1;
    let disposed = false;
    function settle(id) {
        const entry = waiting.get(id);
        if (!entry)
            return null;
        waiting.delete(id);
        entry.cancelTimeout();
        return entry;
    }
    const onMessage = (event) => {
        if (!isDecodeResponse(event.data))
            return;
        const entry = settle(event.data.id);
        if (!entry)
            return;
        if (event.data.error !== undefined) {
            entry.reject(new Error(event.data.error));
            return;
        }
        const tile = event.data.tile;
        entry.resolve(tile ? receiveVectorTile(tile) : null);
    };
    worker.addEventListener('message', onMessage);
    return {
        decode(bytes, tile) {
            if (disposed)
                return Promise.reject(new Error('vector tile worker decoder is disposed'));
            const id = nextId;
            nextId += 1;
            return new Promise((resolve, reject) => {
                const cancelTimeout = scheduleTimeout(() => {
                    const entry = settle(id);
                    entry?.reject(new Error(`vector tile decode timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                waiting.set(id, { cancelTimeout, reject, resolve });
                const buffer = tightBuffer(bytes);
                const request = {
                    bytes: buffer,
                    channel: VECTOR_TILE_DECODE_CHANNEL,
                    id,
                    x: tile.x,
                    y: tile.y,
                    z: tile.z,
                };
                try {
                    // Two calls rather than one with `undefined`: a real `Worker` reads
                    // a second argument as its transfer list or as an options object,
                    // and which one it picks for `undefined` is not worth relying on.
                    if (transfer)
                        worker.postMessage(request, [buffer]);
                    else
                        worker.postMessage(request);
                }
                catch (reason) {
                    settle(id)?.reject(reason instanceof Error ? reason : new Error(String(reason)));
                }
            });
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            worker.removeEventListener?.('message', onMessage);
            for (const id of [...waiting.keys()]) {
                settle(id)?.reject(new Error('vector tile worker decoder is disposed'));
            }
        },
        get pending() {
            return waiting.size;
        },
    };
}
//# sourceMappingURL=vector-tile-worker.js.map