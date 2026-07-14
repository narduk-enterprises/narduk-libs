import type { MapKitEnv, MapKitServerConfig } from './shared-config.js';
export interface MapKitTokenRequestOptions {
    config?: MapKitServerConfig;
    rateLimit?: MapKitRateLimitHook;
    request: Request;
}
export interface MapKitTokenResult {
    configured: boolean;
    expiresAt?: string | null;
    error?: string;
    origin: string;
    retryAfterSeconds?: number;
    status?: number;
    token: string;
}
export interface MapKitRateLimitContext {
    origin: string;
    request: Request;
}
export interface MapKitRateLimitDecision {
    allowed: boolean;
    error?: string;
    retryAfterSeconds?: number;
}
export type MapKitRateLimitHook = (context: MapKitRateLimitContext) => boolean | MapKitRateLimitDecision | Promise<boolean | MapKitRateLimitDecision>;
export interface MapKitTokenResponseOptions {
    rateLimit?: MapKitRateLimitHook;
}
export declare function getOriginFromRequest(request: Request, fallbackOrigin?: string): string;
export declare function issueMapKitTokenForRequest(options: MapKitTokenRequestOptions): Promise<MapKitTokenResult>;
export declare function mapKitTokenResponse(request: Request, config?: MapKitServerConfig, options?: MapKitTokenResponseOptions): Promise<Response>;
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
export declare function mapKitTokenResponseFromEnv(request: Request, env: MapKitEnv, overrides?: Partial<MapKitServerConfig>): Promise<Response>;
export declare function createMapKitTokenHandler(config?: MapKitServerConfig, options?: MapKitTokenResponseOptions): (request: Request) => Promise<Response>;
export declare function clearMapKitTokenCacheForTests(): void;
//# sourceMappingURL=handler.d.ts.map