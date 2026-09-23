import { MAPKIT_SIGNING_FAILED_MESSAGE, clearMapKitTokenCacheForTests, getOriginFromRequest, isMapKitHostAllowed, issueMapKitTokenForRequest as issueWorkerMapKitTokenForRequest, mapKitRoutedOrigin, mapKitTokenResponse as workerMapKitTokenResponse, mapKitTokenResponseFromEnv, } from './handler.js';
import { resolveMapKitServerConfig } from './config.js';
export * from './config.js';
export { MAPKIT_SIGNING_FAILED_MESSAGE, clearMapKitTokenCacheForTests, getOriginFromRequest, isMapKitHostAllowed, mapKitRoutedOrigin, mapKitTokenResponseFromEnv, };
/**
 * Node-only token resolver. It may read `process.env` and use the optional
 * Doppler CLI fallback before delegating token creation to the Web Crypto
 * implementation.
 */
export async function issueMapKitTokenForRequest(options) {
    const config = await resolveMapKitServerConfig(options.config);
    // Spread, never a hand-copied list of three names: `self` is new on the
    // handler in 2.1.0, and a wrapper that forwards by name silently drops
    // whatever the handler grows next (narduk-libs#431 review F8).
    return issueWorkerMapKitTokenForRequest({ ...options, config });
}
export async function mapKitTokenResponse(request, config, options = {}) {
    try {
        const resolvedConfig = await resolveMapKitServerConfig(config);
        return workerMapKitTokenResponse(request, resolvedConfig, options);
    }
    catch {
        // Same rule as the handler's own catch: a constant, never the thrown
        // message. Config resolution here can have read a Doppler command line.
        return new Response(JSON.stringify({ error: 'signing-failed', message: MAPKIT_SIGNING_FAILED_MESSAGE }), {
            headers: {
                'cache-control': 'no-store',
                'content-type': 'application/json; charset=utf-8',
                vary: 'origin, sec-fetch-site',
                'x-content-type-options': 'nosniff',
            },
            status: 500,
        });
    }
}
export function createMapKitTokenHandler(config, options = {}) {
    return (request) => mapKitTokenResponse(request, config, options);
}
//# sourceMappingURL=node.js.map