---
'@narduk-enterprises/narduk-core': minor
---

Add `defineRateLimitedHandler`, a per-route rate limit an app opts into by
wrapping one handler — so no app writes its own limiter and no app edits this
package's closed `RATE_LIMIT_POLICIES` registry to limit a route it owns.

Both layers run and a denial from either answers 429. The Cloudflare Rate
Limiting binding goes first where the app declared a matching top-level
`ratelimits` entry, because its counters are coordinated per Cloudflare location
rather than per isolate. An in-isolate fixed window always runs too: the
binding's `.limit()` resolves to `{ success }` with no remaining count and no
reset instant, so it cannot produce the `RateLimit-*` headers; its `period`
accepts only 10 or 60 seconds, so it cannot express any other window; and it is
a `workerd` primitive with no documented local-dev simulation, so it is absent
in `nuxt dev`, in unit tests and under plain Node.

The binding is an upgrade, never a prerequisite. Cloudflare's documentation, its
GA changelog entry and the Workers pricing page are all silent on whether the
binding is available on the Workers Free plan, so an app on Free adopts the
helper with no wrangler change and can add the binding later without touching
route code.

A denial answers `Retry-After`, `RateLimit-Remaining: 0`, the request's
`x-request-id`, and one structured warning through
`@narduk-enterprises/narduk-logging` keyed on the matched route template rather
than the raw path. `/api/health`, `robots.txt` and the sitemap surfaces are
never limited, query string included, because a 429 on a health probe reads as
an outage and a throttled crawler is an SEO self-injury.

Response headers follow draft-ietf-httpapi-ratelimit-headers-11, which specifies
`RateLimit-Policy` and `RateLimit` as Structured Fields rather than the
`RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` triad that earlier
revisions defined and that deployed APIs actually ship; both families are
emitted by default and the choice is configurable.

`runtimeConfig.nardukRateLimit` carries the defaults plus per-key `routes`
overrides that win over what a route declared, so an operator can retune an
allowance without a code change. Existing `enforceRateLimitPolicy` callers are
unaffected; `CloudflareRateLimitBinding` keeps its export from
`runtime/server/utils/rateLimit.ts`.
