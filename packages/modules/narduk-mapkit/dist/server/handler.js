/**
 * The same-host, fail-closed MapKit token route (narduk-libs#421 §e).
 *
 * Everything here is `Request`-level on purpose: the routed request URL is the
 * ONLY source of the origin claim, so the contract can be stated -- and tested
 * -- without a framework. An h3/Nitro caller passes
 * `getRequestURL(event, { xForwardedHost: false }).origin` as `self`; a Worker
 * caller passes nothing, because `request.url` there is already the routed URL
 * and cannot be forged.
 *
 * What is deliberately NOT trusted: `Origin`, `Referer`, and every
 * `X-Forwarded-*` header. They are evidence about the caller, never the source
 * of the claim Apple will enforce.
 */
import { createMapKitToken } from '../token/jwt.js';
import { hasSigningConfig, mapKitConfigFromEnv } from './shared-config.js';
/** Apple issues a 1800 s accessKey at bootstrap; minting longer than that buys nothing. */
export const MAPKIT_TOKEN_TTL_MAX_SECONDS = 1800;
export const MAPKIT_TOKEN_TTL_MIN_SECONDS = 60;
/** §e.4: capped at 32 entries, keyed on `self` -- not on anything a caller supplies. */
const CACHE_MAX_ENTRIES = 32;
/** §e.4: a cached token is reused until five minutes before it expires. */
const CACHE_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_DEFAULT_RETRY_AFTER_SECONDS = 60;
/** Config keys 2.1.0 ignores. Logged by NAME when present; never by value. */
const DEPRECATED_CONFIG_KEYS = ['allowedOrigins', 'staticToken'];
const signedTokenCache = new Map();
/**
 * The routed request origin -- §e.1's `self`.
 *
 * Built from `URL.origin` so a default port is omitted (`https://example.com`,
 * never `https://example.com:443`): Apple enforces the claim on scheme + host +
 * port exactly, and a spurious `:443` fails every request.
 */
export function mapKitSelfOrigin(request, self) {
    if (self)
        return new URL(self).origin;
    return new URL(request.url).origin;
}
/** An absolute-form (`https://host/p`) or protocol-relative (`//host/p`) target. */
const NON_ORIGIN_FORM_REQUEST_TARGET = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
/**
 * §e.1's `self` for a caller that is not already holding the routed `Request`.
 *
 * Answers `null` when no origin can be trusted; pass that straight through as
 * `self` and the route refuses with 403 without minting anything.
 *
 * 1. A Fetch `Request` wins. Its `url` is the routed URL; a `Host` header
 *    cannot move it.
 * 2. Otherwise the framework-derived origin -- but only for an ORIGIN-FORM
 *    request target. Node's `http` server accepts an absolute-form request line
 *    (`GET https://evil.example/api/mapkit-token HTTP/1.1`) and hands it
 *    through verbatim; `new URL(absolute, base)` then IGNORES the base, so the
 *    host in the request line, not the host the app was routed on, would name
 *    the claim Apple enforces. A protocol-relative target does the same.
 *
 * NODE CAVEAT: an origin-form target with a forged `Host:` still names the
 * derived origin. Nothing at this layer can tell a routed `Host` from a forged
 * one -- the deployment has to refuse unknown hosts. On Cloudflare Workers, the
 * estate's target, the edge binds `Host` to the routed hostname and step 1
 * applies anyway.
 */
export function mapKitRoutedOrigin(options) {
    if (options.request)
        return new URL(options.request.url).origin;
    if (NON_ORIGIN_FORM_REQUEST_TARGET.test(options.requestTarget ?? ''))
        return null;
    if (!options.derivedOrigin)
        return null;
    return new URL(options.derivedOrigin).origin;
}
/**
 * 2.0.x name, kept so no export disappears. It now answers the routed origin,
 * NOT the `Origin` header -- which is the whole point of §e.1.
 */
export function getOriginFromRequest(request, _fallbackOrigin) {
    return mapKitSelfOrigin(request);
}
function originOf(value) {
    if (!value)
        return null;
    try {
        return new URL(value).origin;
    }
    catch {
        return null;
    }
}
/**
 * §e.1: same-origin evidence, required.
 *
 * A MISSING `Origin` is legitimate -- measured in real Chromium, a same-origin
 * `fetch()` sends no `Origin` at all and `Sec-Fetch-Site: same-origin`. The
 * signal lives in `Sec-Fetch-Site`; `Origin`, when present, may only confirm.
 */
export function isMapKitRequestSameOrigin(request, self) {
    const origin = request.headers.get('origin');
    const hasOrigin = origin !== null && origin !== '';
    // In EVERY case, a present Origin that disagrees with the routed origin
    // refuses -- `null` included. An opaque origin (a sandboxed iframe, a
    // `data:` document) is BY DEFINITION not same-origin with this route, so it
    // fails closed rather than falling through to Sec-Fetch-Site.
    if (hasOrigin && originOf(origin) !== self)
        return false;
    const secFetchSite = request.headers.get('sec-fetch-site');
    if (secFetchSite !== null && secFetchSite !== '')
        return secFetchSite === 'same-origin';
    if (hasOrigin)
        return originOf(origin) === self;
    const referer = originOf(request.headers.get('referer'));
    if (referer !== null)
        return referer === self;
    return false;
}
function clampTtlSeconds(value) {
    const requested = value ?? MAPKIT_TOKEN_TTL_MAX_SECONDS;
    if (!Number.isFinite(requested))
        return MAPKIT_TOKEN_TTL_MAX_SECONDS;
    return Math.min(MAPKIT_TOKEN_TTL_MAX_SECONDS, Math.max(MAPKIT_TOKEN_TTL_MIN_SECONDS, Math.floor(requested)));
}
function deprecatedKeysPresent(config) {
    return DEPRECATED_CONFIG_KEYS.filter((key) => {
        const value = config[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
}
function normalizeRateLimitDecision(decision) {
    return typeof decision === 'boolean' ? { allowed: decision } : decision;
}
/**
 * Decide one token request. Order is deliberate: method, then same-origin, then
 * the rate limiter, then signing config. A cross-origin caller is refused
 * WITHOUT consuming a legitimate caller's allowance.
 */
export async function issueMapKitTokenForRequest(options) {
    const config = options.config ?? {};
    // An explicit `null` is the caller saying it cannot name the routed origin.
    // There is nothing to fall back to that would not be caller-controlled, so
    // the only safe answer is a refusal -- before the limiter, before signing.
    if (options.self === null) {
        return { refusal: 'not-same-origin', self: '', status: 403, token: '' };
    }
    const self = mapKitSelfOrigin(options.request, options.self);
    if (options.request.method !== 'GET') {
        return { refusal: 'method-not-allowed', self, status: 405, token: '' };
    }
    if (!isMapKitRequestSameOrigin(options.request, self)) {
        return { refusal: 'not-same-origin', self, status: 403, token: '' };
    }
    if (options.rateLimit) {
        const decision = normalizeRateLimitDecision(await options.rateLimit({ origin: self, request: options.request, self }));
        if (!decision.allowed) {
            return {
                refusal: 'rate-limited',
                retryAfterSeconds: decision.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_RETRY_AFTER_SECONDS,
                self,
                status: 429,
                token: '',
            };
        }
    }
    if (!hasSigningConfig(config)) {
        return { refusal: 'unconfigured', self, status: 503, token: '' };
    }
    const expiresInSeconds = clampTtlSeconds(config.tokenExpiresInSeconds);
    const cacheKey = cacheEnabled(config)
        ? await signedTokenCacheKey(config, self, expiresInSeconds)
        : null;
    const cached = cacheKey ? readCachedSignedToken(cacheKey) : null;
    if (cached) {
        return { expiresAt: cached.expiresAtMs, self, status: 200, token: cached.token };
    }
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const token = await createMapKitToken({
        expiresInSeconds,
        issuedAtSeconds,
        keyId: config.keyId,
        // The claim is the routed origin and nothing else (§e.3).
        origin: self,
        privateKey: config.privateKey,
        teamId: config.teamId,
    });
    const expiresAtMs = (issuedAtSeconds + expiresInSeconds) * 1000;
    if (cacheKey)
        writeCachedSignedToken(cacheKey, token, expiresAtMs);
    return { expiresAt: expiresAtMs, self, status: 200, token };
}
/** The ONLY thing a 500 ever says. See the catch in `mapKitTokenResponse`. */
export const MAPKIT_SIGNING_FAILED_MESSAGE = 'Failed to generate a MapKit token.';
/** The routed origin for a LOG line, on a path where `self` may be the fault. */
function safeSelfOrigin(request, self) {
    if (self === null)
        return '';
    try {
        return mapKitSelfOrigin(request, self);
    }
    catch {
        return '';
    }
}
const REFUSAL_MESSAGES = {
    'method-not-allowed': 'This route answers GET only.',
    'not-same-origin': 'This MapKit token route only answers same-origin requests from the page it serves. ' +
        'Opening it directly in a browser tab is a cross-site navigation and is refused by design.',
    'rate-limited': 'Too many MapKit token requests from this client. Try again shortly.',
    unconfigured: 'MapKit token signing is not configured on this deployment. ' +
        'APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY must all be present.',
};
/**
 * The §e route handler.
 *
 * The rate-limit hook is consulted by THIS function, so it cannot be bypassed by
 * the shape of the path that reached it -- a trailing slash, a different case, a
 * duplicated separator (buoys PR 122 review, F1). A path-matching middleware can
 * be walked around; a wrapped handler cannot.
 */
export async function mapKitTokenResponse(request, config, options = {}) {
    const headers = {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        // Never an Access-Control-Allow-Origin, on any response (§e.1.4).
        vary: 'origin, sec-fetch-site',
        // Defence in depth: a JSON body with quoted keys is a SyntaxError as a
        // script, but nothing here should ever be MIME-sniffed into one.
        'x-content-type-options': 'nosniff',
    };
    try {
        const result = await issueMapKitTokenForRequest({
            ...options,
            ...(config ? { config } : {}),
            request,
        });
        options.log?.({
            deprecatedKeys: deprecatedKeysPresent(config ?? {}),
            ...(result.refusal === undefined ? {} : { refusal: result.refusal }),
            self: result.self,
            status: result.status,
        });
        if (result.refusal === 'method-not-allowed')
            headers['allow'] = 'GET';
        if (result.retryAfterSeconds !== undefined) {
            headers['retry-after'] = String(result.retryAfterSeconds);
        }
        const body = result.refusal
            ? { error: result.refusal, message: REFUSAL_MESSAGES[result.refusal] }
            : { expiresAt: result.expiresAt, token: result.token };
        return new Response(JSON.stringify(body), { headers, status: result.status });
    }
    catch {
        // A server fault is never a token, and never a diagnostic either. The
        // thrown message is the app's own -- a rate-limit hook's connection string,
        // a signer's report on the key it was handed -- so the body is a CONSTANT
        // and the error is surfaced only through the caller's own `log` hook.
        // (narduk-libs#431 review F1/F4: this catch used to echo `error.message`.)
        options.log?.({
            deprecatedKeys: deprecatedKeysPresent(config ?? {}),
            refusal: 'unconfigured',
            self: safeSelfOrigin(request, options.self),
            status: 500,
        });
        return new Response(JSON.stringify({ error: 'signing-failed', message: MAPKIT_SIGNING_FAILED_MESSAGE }), { headers, status: 500 });
    }
}
/**
 * Cloudflare Worker / Fetch convenience: reads Apple credentials from a passed
 * `env` binding object rather than `process.env`, and signs with Web Crypto.
 */
export function mapKitTokenResponseFromEnv(request, env, overrides = {}, options = {}) {
    return mapKitTokenResponse(request, { ...mapKitConfigFromEnv(env), ...overrides, doppler: false }, options);
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
/**
 * Keyed on the routed origin plus the signing material, never on anything the
 * caller supplies -- the 2.0.x key was caller-supplied, so the cache was
 * unbounded in an attacker's direction.
 */
async function signedTokenCacheKey(config, self, expiresInSeconds) {
    return [
        config.teamId?.trim() ?? '',
        config.keyId?.trim() ?? '',
        await signingMaterialFingerprint(config.privateKey ?? ''),
        expiresInSeconds,
        self,
    ].join('\0');
}
async function signingMaterialFingerprint(privateKey) {
    const normalizedPrivateKey = privateKey.trim().replaceAll('\\n', '\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedPrivateKey));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function readCachedSignedToken(cacheKey) {
    const cached = signedTokenCache.get(cacheKey);
    if (!cached)
        return null;
    if (cached.expiresAtMs <= Date.now() + CACHE_REFRESH_WINDOW_MS) {
        signedTokenCache.delete(cacheKey);
        return null;
    }
    // Re-insert so the Map's insertion order is LRU order.
    signedTokenCache.delete(cacheKey);
    signedTokenCache.set(cacheKey, cached);
    return cached;
}
function writeCachedSignedToken(cacheKey, token, expiresAtMs) {
    signedTokenCache.set(cacheKey, { expiresAtMs, token });
    while (signedTokenCache.size > CACHE_MAX_ENTRIES) {
        const oldestKey = signedTokenCache.keys().next().value;
        if (oldestKey === undefined)
            break;
        signedTokenCache.delete(oldestKey);
    }
}
//# sourceMappingURL=handler.js.map