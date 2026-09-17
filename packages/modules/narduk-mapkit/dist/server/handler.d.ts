import type { MapKitEnv, MapKitServerConfig } from './shared-config.js';
/** Apple issues a 1800 s accessKey at bootstrap; minting longer than that buys nothing. */
export declare const MAPKIT_TOKEN_TTL_MAX_SECONDS = 1800;
export declare const MAPKIT_TOKEN_TTL_MIN_SECONDS = 60;
export type MapKitTokenRefusal = 'method-not-allowed' | 'not-same-origin' | 'rate-limited' | 'unconfigured';
export interface MapKitRateLimitContext {
    /** Kept for 2.0.x callers; always equal to `self`. */
    origin: string;
    request: Request;
    /** The routed request origin -- scheme + host + port. */
    self: string;
}
export interface MapKitRateLimitDecision {
    allowed: boolean;
    error?: string;
    retryAfterSeconds?: number;
}
export type MapKitRateLimitHook = (context: MapKitRateLimitContext) => boolean | MapKitRateLimitDecision | Promise<boolean | MapKitRateLimitDecision>;
/** Never carries a token, a JWT fragment, or any credential-bearing header value. */
export interface MapKitTokenRouteLogEntry {
    /** Config keys that are present but ignored in 2.1.0, by NAME. */
    deprecatedKeys: readonly string[];
    /** Absent on success. */
    refusal?: MapKitTokenRefusal;
    /** The routed request origin the claim was (or would have been) built from. */
    self: string;
    status: number;
}
export interface MapKitTokenResponseOptions {
    /** Structured, value-free route logging (§e.4). */
    log?: (entry: MapKitTokenRouteLogEntry) => void;
    rateLimit?: MapKitRateLimitHook;
    /**
     * The routed request origin. h3 callers pass
     * `getRequestURL(event, { xForwardedHost: false }).origin`. Omitted, it is
     * read from `request.url`, which is correct on Workers and in tests.
     */
    self?: string;
}
export interface MapKitTokenRequestOptions extends MapKitTokenResponseOptions {
    config?: MapKitServerConfig;
    request: Request;
}
export interface MapKitTokenResult {
    /** Epoch milliseconds the minted token stops being mintable with. */
    expiresAt?: number;
    refusal?: MapKitTokenRefusal;
    retryAfterSeconds?: number;
    /** The routed request origin; the `origin` claim is built from exactly this. */
    self: string;
    status: number;
    token: string;
}
/**
 * The routed request origin -- §e.1's `self`.
 *
 * Built from `URL.origin` so a default port is omitted (`https://example.com`,
 * never `https://example.com:443`): Apple enforces the claim on scheme + host +
 * port exactly, and a spurious `:443` fails every request.
 */
export declare function mapKitSelfOrigin(request: Request, self?: string): string;
/**
 * 2.0.x name, kept so no export disappears. It now answers the routed origin,
 * NOT the `Origin` header -- which is the whole point of §e.1.
 */
export declare function getOriginFromRequest(request: Request, _fallbackOrigin?: string): string;
/**
 * §e.1: same-origin evidence, required.
 *
 * A MISSING `Origin` is legitimate -- measured in real Chromium, a same-origin
 * `fetch()` sends no `Origin` at all and `Sec-Fetch-Site: same-origin`. The
 * signal lives in `Sec-Fetch-Site`; `Origin`, when present, may only confirm.
 */
export declare function isMapKitRequestSameOrigin(request: Request, self: string): boolean;
/**
 * Decide one token request. Order is deliberate: method, then same-origin, then
 * the rate limiter, then signing config. A cross-origin caller is refused
 * WITHOUT consuming a legitimate caller's allowance.
 */
export declare function issueMapKitTokenForRequest(options: MapKitTokenRequestOptions): Promise<MapKitTokenResult>;
/**
 * The §e route handler.
 *
 * The rate-limit hook is consulted by THIS function, so it cannot be bypassed by
 * the shape of the path that reached it -- a trailing slash, a different case, a
 * duplicated separator (buoys PR 122 review, F1). A path-matching middleware can
 * be walked around; a wrapped handler cannot.
 */
export declare function mapKitTokenResponse(request: Request, config?: MapKitServerConfig, options?: MapKitTokenResponseOptions): Promise<Response>;
/**
 * Cloudflare Worker / Fetch convenience: reads Apple credentials from a passed
 * `env` binding object rather than `process.env`, and signs with Web Crypto.
 */
export declare function mapKitTokenResponseFromEnv(request: Request, env: MapKitEnv, overrides?: Partial<MapKitServerConfig>, options?: MapKitTokenResponseOptions): Promise<Response>;
export declare function createMapKitTokenHandler(config?: MapKitServerConfig, options?: MapKitTokenResponseOptions): (request: Request) => Promise<Response>;
export declare function clearMapKitTokenCacheForTests(): void;
//# sourceMappingURL=handler.d.ts.map