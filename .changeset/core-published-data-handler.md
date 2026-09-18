---
'@narduk-enterprises/narduk-core': minor
---

New server util
`definePublishedDataHandler(handler, { profile, tags?, vary?, fallbackMessage?, rateLimit? })`
for public published-data reads (narduk-libs#514). It applies the cache profile
only after the handler succeeds, so an error never advertises a cacheable
posture. An internal failure without a `statusCode` is logged and answered with
a sanitized 503, and a deliberate `createError` passes through unchanged. Rate
limiting goes through `defineRateLimitedHandler` and is applied only when
`rateLimit` is passed. It is auto-imported, so an app with its own
`definePublishedDataHandler` in `server/utils` (Buoys) should replace its local
copy when it adopts this release.
