/**
 * The Cloudflare Workers Rate Limiting binding surface.
 *
 * Declared in wrangler under the top-level `ratelimits` array (GA since
 * 2025-09-19; the pre-GA `unsafe.bindings` form with `type = "ratelimit"` still
 * works but is no longer the documented shape):
 *
 * ```jsonc
 * { "ratelimits": [{ "name": "RL_120", "namespace_id": "32195120",
 *                    "simple": { "limit": 120, "period": 60 } }] }
 * ```
 *
 * `namespace_id` is unique per Cloudflare **account**, not per Worker: two
 * bindings with the same id share counters across every Worker on the
 * account. Never paste an example id; derive it from the Worker name with
 * `rateLimitNamespaceId` in `../../shared/rate-limit-namespace.ts` (the id
 * above is `rateLimitNamespaceId('riverstatus', 120)`).
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
