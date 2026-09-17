/**
 * The same-host MapKit token route (§e).
 *
 * The handler assembles nothing: status, body, `cache-control`, `vary`, `allow`
 * and `retry-after` all come from `mapKitTokenResponse()`, so this route cannot
 * drift from the §e contract by inventing headers of its own.
 *
 * `self` is the **routed request's own origin**, read with `xForwardedHost:
 * false`. A forwarded host header is attacker-controllable and would let a
 * request mint a token claiming an origin it was never served from.
 */
import { useRuntimeConfig } from '#imports';
import { defineEventHandler, getRequestHeaders, getRequestURL } from 'h3';
import { mapKitTokenResponse } from '../../../server/handler.js';
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
        self: getRequestURL(event, { xForwardedHost: false }).origin,
    });
});
//# sourceMappingURL=mapkit-token.get.js.map