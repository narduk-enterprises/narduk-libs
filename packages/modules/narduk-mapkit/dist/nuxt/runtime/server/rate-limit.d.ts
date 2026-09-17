/**
 * The default rate-limit hook for the token route.
 *
 * §e.4 hands rate limiting to narduk-core, and an app that mounts its limiter on
 * `event.context.nardukMapKit.rateLimit` still wins. But the route mints signed
 * JWTs, so leaving it unlimited by default when narduk-core is absent is the
 * wrong failure mode -- and the 2.0.x `rateLimit` seam had zero consumers
 * precisely because it required the app to build the limiter itself.
 *
 * Deliberately in-process and per-instance: it bounds one server's own signing
 * work, and it makes no claim to be a distributed limiter. A serverless
 * deployment gets one window per warm instance, which is why an app with real
 * abuse exposure still mounts narduk-core's.
 */
import type { MapKitRateLimitHook } from '../../../server/handler.js';
export interface MapKitFixedWindowOptions {
    limit: number;
    /** Injected so a test does not have to wait a window out. */
    now?: () => number;
    windowSeconds: number;
}
export declare function createMapKitFixedWindowRateLimit(options: MapKitFixedWindowOptions): MapKitRateLimitHook;
//# sourceMappingURL=rate-limit.d.ts.map