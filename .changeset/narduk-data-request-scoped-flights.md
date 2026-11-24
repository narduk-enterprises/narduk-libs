---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`createNardukDataClient` no longer shares an in-flight load across requests. On Cloudflare Workers a
promise settles only in the request that created it: a read that joined another request's load
failed ("This promise was created by a request that has since ended") once that request ended, and
the abandoned load stayed in the single-flight map, so every later read in the isolate failed at
once (lakestat-us#484: about one `/api/health` request in ten answered 503). Loads are now shared
only by reads passing the same new `context.scope` (the H3Event or Request they serve); reads
without one each load for themselves. The memo is still shared, and a soft-stale burst still starts
one background refresh, which no other read awaits.
