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
 * serveVectorTileDecoder(self, createMvtDecoder({ layers: ['reaches'], properties: ['ri', 'so'] }))
 * ```
 */
import { sendVectorTile, VECTOR_TILE_DECODE_CHANNEL } from '../client/vector-tile-worker.js';
function isDecodeRequest(data) {
    if (typeof data !== 'object' || data === null)
        return false;
    const message = data;
    return (message.channel === VECTOR_TILE_DECODE_CHANNEL &&
        typeof message.id === 'number' &&
        message.bytes instanceof ArrayBuffer);
}
/**
 * Host {@link VECTOR_TILE_DECODE_CHANNEL} on a worker scope.
 *
 * Every reply carries the request id, so one worker can serve a screenful of
 * tiles at once. A decode that throws is reported as a message rather than as
 * an unhandled rejection, so the main thread fails that one tile and the map
 * keeps drawing. Returns a function that stops serving.
 */
export function serveVectorTileDecoder(scope, decode) {
    const onMessage = (event) => {
        if (!isDecodeRequest(event.data))
            return;
        const { bytes, id, x, y, z } = event.data;
        void respond(scope, id, decode, new Uint8Array(bytes), { x, y, z });
    };
    scope.addEventListener('message', onMessage);
    return () => {
        scope.removeEventListener?.('message', onMessage);
    };
}
async function respond(scope, id, decode, bytes, address) {
    try {
        const tile = await decode(bytes, address);
        if (!tile) {
            const empty = {
                channel: VECTOR_TILE_DECODE_CHANNEL,
                id,
                tile: null,
            };
            scope.postMessage(empty);
            return;
        }
        const { message, transfer } = sendVectorTile(tile);
        const response = {
            channel: VECTOR_TILE_DECODE_CHANNEL,
            id,
            tile: message,
        };
        scope.postMessage(response, transfer);
    }
    catch (reason) {
        const failed = {
            channel: VECTOR_TILE_DECODE_CHANNEL,
            error: reason instanceof Error ? reason.message : String(reason),
            id,
        };
        scope.postMessage(failed);
    }
}
//# sourceMappingURL=serve.js.map