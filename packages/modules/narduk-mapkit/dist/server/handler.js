import { createMapKitToken, DEFAULT_MAPKIT_TOKEN_TTL_SECONDS } from '../token/jwt.js';
import { hasSigningConfig, hasUsableStaticToken, isOriginAllowed, mapKitConfigFromEnv, parseAllowedOrigins, } from './shared-config.js';
const DEFAULT_CACHE_MAX_ENTRIES = 100;
const DEFAULT_CACHE_REFRESH_WINDOW_MS = 60_000;
const signedTokenCache = new Map();
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
    const config = options.config ?? {};
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
    const rateLimitDecision = options.rateLimit
        ? normalizeRateLimitDecision(await options.rateLimit({ origin, request: options.request }))
        : null;
    if (rateLimitDecision && !rateLimitDecision.allowed) {
        return {
            configured: true,
            error: rateLimitDecision.error ?? 'Too many MapKit token requests.',
            origin,
            ...(rateLimitDecision.retryAfterSeconds === undefined
                ? {}
                : { retryAfterSeconds: rateLimitDecision.retryAfterSeconds }),
            status: 429,
            token: '',
        };
    }
    if (hasSigningConfig(config)) {
        const expiresInSeconds = config.tokenExpiresInSeconds ?? DEFAULT_MAPKIT_TOKEN_TTL_SECONDS;
        const cacheKey = cacheEnabled(config) ? await signedTokenCacheKey(config, origin) : null;
        const cached = cacheKey ? readCachedSignedToken(config, cacheKey) : null;
        if (cached) {
            return {
                configured: true,
                expiresAt: new Date(cached.expiresAtMs).toISOString(),
                origin,
                token: cached.token,
            };
        }
        const issuedAtSeconds = Math.floor(Date.now() / 1000);
        const tokenOptions = {
            expiresInSeconds,
            issuedAtSeconds,
            keyId: config.keyId,
            origin,
            privateKey: config.privateKey,
            teamId: config.teamId,
        };
        const token = await createMapKitToken(tokenOptions);
        const expiresAtMs = (issuedAtSeconds + expiresInSeconds) * 1000;
        if (cacheKey)
            writeCachedSignedToken(config, cacheKey, token, expiresAtMs);
        return { configured: true, expiresAt: new Date(expiresAtMs).toISOString(), origin, token };
    }
    if (hasUsableStaticToken(config)) {
        return { configured: true, expiresAt: null, origin, token: config.staticToken.trim() };
    }
    return {
        configured: false,
        error: 'MapKit is not configured. Set APPLE_PRIVATE_KEY, APPLE_TEAM_ID, and APPLE_KEY_ID to sign origin-scoped tokens, or provide a non-expired MAPKIT_TOKEN / APPLE_MAPKIT_TOKEN.',
        origin,
        token: '',
    };
}
export async function mapKitTokenResponse(request, config, options = {}) {
    try {
        const result = await issueMapKitTokenForRequest(config
            ? { request, config, ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}) }
            : { request, ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}) });
        const status = result.status ?? (result.configured ? (result.token ? 200 : 403) : 503);
        const headers = result.retryAfterSeconds === undefined
            ? undefined
            : { 'retry-after': String(result.retryAfterSeconds) };
        return jsonResponse(result, status, headers);
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
        ...overrides,
        doppler: false,
    });
}
export function createMapKitTokenHandler(config, options = {}) {
    return (request) => mapKitTokenResponse(request, config, options);
}
export function clearMapKitTokenCacheForTests() {
    signedTokenCache.clear();
}
function cacheEnabled(config) {
    return config.cache !== false;
}
function cacheMaxEntries(config) {
    const maxEntries = typeof config.cache === 'object' ? config.cache.maxEntries : undefined;
    return typeof maxEntries === 'number' && Number.isFinite(maxEntries) && maxEntries > 0
        ? Math.floor(maxEntries)
        : DEFAULT_CACHE_MAX_ENTRIES;
}
function cacheRefreshWindowMs(config) {
    const refreshWindowMs = typeof config.cache === 'object' ? config.cache.refreshWindowMs : undefined;
    return typeof refreshWindowMs === 'number' &&
        Number.isFinite(refreshWindowMs) &&
        refreshWindowMs >= 0
        ? refreshWindowMs
        : DEFAULT_CACHE_REFRESH_WINDOW_MS;
}
async function signedTokenCacheKey(config, origin) {
    return [
        config.teamId?.trim() ?? '',
        config.keyId?.trim() ?? '',
        await signingMaterialFingerprint(config.privateKey ?? ''),
        config.tokenExpiresInSeconds ?? DEFAULT_MAPKIT_TOKEN_TTL_SECONDS,
        origin.replace(/\/$/, ''),
    ].join('\0');
}
async function signingMaterialFingerprint(privateKey) {
    const normalizedPrivateKey = privateKey.trim().replaceAll('\\n', '\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedPrivateKey));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function readCachedSignedToken(config, cacheKey) {
    if (!cacheEnabled(config))
        return null;
    const cached = signedTokenCache.get(cacheKey);
    if (!cached)
        return null;
    if (cached.expiresAtMs <= Date.now() + cacheRefreshWindowMs(config)) {
        signedTokenCache.delete(cacheKey);
        return null;
    }
    signedTokenCache.delete(cacheKey);
    signedTokenCache.set(cacheKey, cached);
    return cached;
}
function writeCachedSignedToken(config, cacheKey, token, expiresAtMs) {
    if (!cacheEnabled(config))
        return;
    signedTokenCache.set(cacheKey, { expiresAtMs, token });
    const maxEntries = cacheMaxEntries(config);
    while (signedTokenCache.size > maxEntries) {
        const oldestKey = signedTokenCache.keys().next().value;
        if (!oldestKey)
            break;
        signedTokenCache.delete(oldestKey);
    }
}
function normalizeRateLimitDecision(decision) {
    return typeof decision === 'boolean' ? { allowed: decision } : decision;
}
function jsonResponse(body, status, additionalHeaders = {}) {
    return new Response(JSON.stringify(body), {
        headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            ...additionalHeaders,
        },
        status,
    });
}
//# sourceMappingURL=handler.js.map