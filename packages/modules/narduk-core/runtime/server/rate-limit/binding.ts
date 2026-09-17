/**
 * The Cloudflare Workers Rate Limiting binding surface.
 *
 * Declared in wrangler under the top-level `ratelimits` array (GA since
 * 2025-09-19; the pre-GA `unsafe.bindings` form with `type = "ratelimit"` still
 * works but is no longer the documented shape):
 *
 * ```jsonc
 * { "ratelimits": [{ "name": "RL_120", "namespace_id": "1001",
 *                    "simple": { "limit": 120, "period": 60 } }] }
 * ```
 *
 * Counters are coordinated per Cloudflare location, not globally, and
 * Cloudflare describes them as "permissive, eventually consistent, and
 * intentionally designed to not be used as an accurate accounting system".
 * `period` accepts only 10 or 60 seconds, and `.limit()` resolves to
 * `{ success }` with no remaining count and no reset instant — which is why
 * `defineRateLimitedHandler` still runs its own window for the `RateLimit-*`
 * headers and for every other window length.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 * @see https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/
 */
export interface CloudflareRateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>
}
