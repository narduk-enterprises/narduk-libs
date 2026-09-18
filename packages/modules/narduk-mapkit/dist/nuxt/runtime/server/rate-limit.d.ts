/**
 * The default rate-limit hook for the token route.
 *
 * §e.4 hands rate limiting to narduk-core, and an app that mounts its limiter on
 * `event.context.nardukMapKit.rateLimit` still wins. But the route mints signed
 * JWTs, so leaving it unlimited by default when narduk-core is absent is the
 * wrong failure mode -- and the 2.0.x `rateLimit` seam had zero consumers
 * precisely because it required the app to build the limiter itself.
 *
 * The implementation lives on the Worker-safe server entry points so a Worker
 * caller of `mapKitTokenResponseFromEnv` uses the same one (narduk-libs#485).
 */
export { createMapKitFixedWindowRateLimit, type MapKitFixedWindowOptions, } from '../../../server/rate-limit.js';
//# sourceMappingURL=rate-limit.d.ts.map