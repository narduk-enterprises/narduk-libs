import { clearMapKitTokenCacheForTests, getOriginFromRequest, issueMapKitTokenForRequest as issueWorkerMapKitTokenForRequest, mapKitTokenResponse as workerMapKitTokenResponse, mapKitTokenResponseFromEnv, } from './handler.js';
import { resolveMapKitServerConfig } from './config.js';
export * from './config.js';
export { clearMapKitTokenCacheForTests, getOriginFromRequest, mapKitTokenResponseFromEnv, };
/**
 * Node-only token resolver. It may read `process.env` and use the optional
 * Doppler CLI fallback before delegating token creation to the Web Crypto
 * implementation.
 */
export async function issueMapKitTokenForRequest(options) {
    const config = await resolveMapKitServerConfig(options.config);
    return issueWorkerMapKitTokenForRequest({
        config,
        ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
        request: options.request,
    });
}
export async function mapKitTokenResponse(request, config, options = {}) {
    try {
        const resolvedConfig = await resolveMapKitServerConfig(config);
        return workerMapKitTokenResponse(request, resolvedConfig, options);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate MapKit token';
        return new Response(JSON.stringify({ configured: false, error: message, token: '' }), {
            headers: {
                'cache-control': 'no-store',
                'content-type': 'application/json; charset=utf-8',
            },
            status: 500,
        });
    }
}
export function createMapKitTokenHandler(config, options = {}) {
    return (request) => mapKitTokenResponse(request, config, options);
}
//# sourceMappingURL=node.js.map