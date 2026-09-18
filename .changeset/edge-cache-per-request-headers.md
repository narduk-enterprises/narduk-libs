---
'@narduk-enterprises/narduk-core': minor
---

Keep per-request headers off shared-cacheable responses (narduk-libs#412,
narduk-libs#418). `setCacheProfile` now strips the `RateLimit-*` family
(`RateLimit`, `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining`,
`RateLimit-Reset`), `Retry-After`, `x-request-id` and `Server-Timing` whenever
it emits a public profile (`live`, `slow`, `static`, or a non-private inline
profile), so a route no longer has to pass `headers: 'none'` to
`defineRateLimitedHandler` to be safe. A new `shared-cache-headers` Nitro plugin
strips the same headers in `beforeResponse` from any non-error response that is
shared-cacheable by then — including a returned web `Response` — so the order of
limiter, logger and profile no longer matters. `none`, `private` profiles and
error responses are untouched; a 429 keeps its `Retry-After`.

The README's Workers Cache section now documents the full enablement contract
(narduk-libs#435): the verified `"cache": { "enabled": true }` mechanism, that a
response with no `Cache-Control` is still stored (a 200 for 2 hours), the
narduk-core >= 2.2.4 precondition, and how to prove a HIT.
