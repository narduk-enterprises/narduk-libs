import { createMapKitToken } from '../token/jwt.js';
import { hasSigningConfig, hasUsableStaticToken, isOriginAllowed, mapKitConfigFromEnv, parseAllowedOrigins, resolveMapKitServerConfig, } from './config.js';
export function getOriginFromRequest(request, fallbackOrigin = 'http://localhost:3000') {
    const origin = request.headers.get('origin');
    if (origin)
        return origin;
    const referer = request.headers.get('referer');
    if (referer) {
        try {
            return new URL(referer).origin;
        }
        catch {
            // Fall back below.
        }
    }
    try {
        return new URL(request.url).origin;
    }
    catch {
        return fallbackOrigin;
    }
}
export async function issueMapKitTokenForRequest(options) {
    const config = await resolveMapKitServerConfig(options.config);
    const origin = getOriginFromRequest(options.request, config.fallbackOrigin);
    const allowedOrigins = parseAllowedOrigins(config.allowedOrigins);
    if (!isOriginAllowed(origin, allowedOrigins)) {
        return {
            configured: true,
            error: 'Origin is not allowed for MapKit token issuance.',
            origin,
            token: '',
        };
    }
    if (hasSigningConfig(config)) {
        const tokenOptions = {
            keyId: config.keyId,
            origin,
            privateKey: config.privateKey,
            teamId: config.teamId,
            ...(config.tokenExpiresInSeconds !== undefined
                ? { expiresInSeconds: config.tokenExpiresInSeconds }
                : {}),
        };
        const token = await createMapKitToken(tokenOptions);
        return { configured: true, origin, token };
    }
    if (hasUsableStaticToken(config)) {
        return { configured: true, origin, token: config.staticToken.trim() };
    }
    return {
        configured: false,
        error: 'MapKit is not configured. Set APPLE_PRIVATE_KEY, APPLE_TEAM_ID, and APPLE_KEY_ID to sign origin-scoped tokens, or provide a non-expired MAPKIT_TOKEN / APPLE_MAPKIT_TOKEN.',
        origin,
        token: '',
    };
}
export async function mapKitTokenResponse(request, config) {
    try {
        const result = await issueMapKitTokenForRequest(config ? { request, config } : { request });
        const status = result.configured ? (result.token ? 200 : 403) : 503;
        return jsonResponse(result, status);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate MapKit token';
        return jsonResponse({ configured: false, error: message, token: '' }, 500);
    }
}
/**
 * Cloudflare Worker / Fetch convenience. Reads Apple credentials from a passed
 * `env` object (Worker secret bindings, not `process.env`) and returns a token
 * `Response`. The Doppler fallback is disabled because Workers have no
 * `child_process`; token signing is pure Web Crypto and runs natively in workerd.
 *
 * ```ts
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     if (new URL(request.url).pathname === '/api/mapkit-token') {
 *       return mapKitTokenResponseFromEnv(request, env)
 *     }
 *     return new Response('Not found', { status: 404 })
 *   },
 * }
 * ```
 */
export function mapKitTokenResponseFromEnv(request, env, overrides = {}) {
    return mapKitTokenResponse(request, {
        ...mapKitConfigFromEnv(env),
        doppler: false,
        ...overrides,
    });
}
export function createMapKitTokenHandler(config) {
    return (request) => config ? mapKitTokenResponse(request, config) : mapKitTokenResponse(request);
}
function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
        },
        status,
    });
}
//# sourceMappingURL=handler.js.map