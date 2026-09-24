/**
 * The opt-in rate-limit hook for the token route.
 *
 * The route applies no limit by default (narduk-libs#485): it builds this
 * limiter only when the app sets the module's `rateLimit` option, and a limiter
 * an app mounts on `event.context.nardukMapKit.rateLimit` wins over both.
 *
 * The implementation lives on the Worker-safe server entry points so a Worker
 * caller of `mapKitTokenResponseFromEnv` uses the same one (narduk-libs#485).
 */
export { createMapKitFixedWindowRateLimit, } from '../../../server/rate-limit.js';
//# sourceMappingURL=rate-limit.js.map