/**
 * The same-host MapKit token route (§e).
 *
 * The handler assembles nothing: status, body, `cache-control`, `vary`, `allow`
 * and `retry-after` all come from `mapKitTokenResponse()`, so this route cannot
 * drift from the §e contract by inventing headers of its own.
 *
 * `self` is the **routed request's own origin**, resolved by
 * `mapKitRoutedOrigin` rather than assembled here: a forwarded host header and
 * an absolute-form request line are both caller-controlled, and either would
 * let a request mint a token claiming an origin it was never served from.
 */
import { useRuntimeConfig } from '#imports';
import { defineEventHandler, getRequestHeaders, getRequestURL } from 'h3';
import { mapKitRoutedOrigin, mapKitTokenResponse } from '../../../server/handler.js';
import { createMapKitFixedWindowRateLimit } from './rate-limit.js';
/** Read known keys directly: Cloudflare bindings may not enumerate. */
function readRuntimeString(sources, keys, fallback) {
    for (const source of sources) {
        for (const key of keys) {
            try {
                const value = source[key];
                if (typeof value === 'string' && value.trim())
                    return value.trim();
            }
            catch {
                // Some non-data Worker bindings throw on property access; try the next source.
            }
        }
    }
    return typeof fallback === 'string' ? fallback.trim() : '';
}
function readProcessEnv() {
    const value = Reflect.get(globalThis, 'process');
    return value?.env ?? {};
}
function readCloudflareEnv(event) {
    const context = event.context;
    return context.cloudflare?.env ?? context._platform?.cloudflare?.env ?? {};
}
function requestFromEvent(event) {
    // A web/workerd adapter (Cloudflare, the estate's target) already holds the
    // routed Fetch Request. Nothing reconstructed from headers can be more
    // faithful than the real one.
    const webRequest = event.web?.request;
    if (webRequest)
        return webRequest;
    const headers = new Headers();
    for (const [name, value] of Object.entries(getRequestHeaders(event))) {
        if (value)
            headers.set(name, value);
    }
    // The real method: the handler answers 405 itself, so a POST must not be
    // laundered into a GET on the way in.
    return new Request(getRequestURL(event), { headers, method: event.method });
}
/**
 * §e.1's `self`.
 *
 * `xForwardedHost: false` keeps an `X-Forwarded-Host` out of the claim.
 * `mapKitRoutedOrigin` prefers the routed Fetch Request where one exists and
 * refuses an absolute-form request line where one does not -- h3 itself
 * documents `getRequestURL().origin` as spoofable. `null` reaches the handler
 * as a 403, never as a guess.
 */
function routedOrigin(event) {
    return mapKitRoutedOrigin({
        derivedOrigin: getRequestURL(event, { xForwardedHost: false }).origin,
        request: event.web?.request,
        // Exactly what `getRequestURL` reads, before `new URL(target, base)` can
        // ignore the base.
        requestTarget: event.node.req.originalUrl ?? event.path,
    });
}
/**
 * One limiter per server instance, built on first use from the module's option.
 * An app that mounts narduk-core's own limiter on the event context wins over
 * it; this only stops an unconfigured route from signing without a ceiling.
 */
let fallbackRateLimit = null;
/**
 * Drop the memoized fallback limiter. A test that changes the configured
 * ceiling needs the next request to rebuild it; without this the only way to
 * get a fresh one is a second module instance, which no supported runtime has.
 */
export function resetMapKitRateLimitForTests() {
    fallbackRateLimit = null;
}
function resolveRateLimit(event, config) {
    const mounted = event.context
        .nardukMapKit?.rateLimit;
    if (mounted)
        return mounted;
    if (fallbackRateLimit)
        return fallbackRateLimit;
    const configured = config['nardukMapKit']?.rateLimit;
    if (typeof configured !== 'object' || configured === null)
        return undefined;
    const { limit, windowSeconds } = configured;
    if (typeof limit !== 'number' || typeof windowSeconds !== 'number')
        return undefined;
    fallbackRateLimit = createMapKitFixedWindowRateLimit({ limit, windowSeconds });
    return fallbackRateLimit;
}
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const sources = [readCloudflareEnv(event), readProcessEnv()];
    const rateLimit = resolveRateLimit(event, config);
    return await mapKitTokenResponse(requestFromEvent(event), {
        doppler: false,
        keyId: readRuntimeString(sources, ['APPLE_KEY_ID'], config['appleKeyId']),
        privateKey: readRuntimeString(sources, ['APPLE_PRIVATE_KEY', 'APPLE_SECRET_KEY'], config['applePrivateKey'] || config['appleSecretKey']),
        teamId: readRuntimeString(sources, ['APPLE_TEAM_ID'], config['appleTeamId']),
    }, {
        ...(rateLimit ? { rateLimit } : {}),
        // The routed origin, never a forwarded host header nor a request line
        // that names its own host (§e.1).
        self: routedOrigin(event),
    });
});
//# sourceMappingURL=mapkit-token.get.js.map