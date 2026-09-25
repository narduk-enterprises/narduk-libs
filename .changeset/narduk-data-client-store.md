---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`createNardukDataClient` takes an opt-in `store`, a Cache-API-shaped
`NardukDataStore`. The new `workersEdgeStore()` returns the Workers zone cache,
`caches.default`, for it. Reads can also pass a `waitUntil` in the request
context.

With a store, a cold isolate reuses a stored manifest for the product's
`ttlMs` and takes checksum-verified artifact bytes from the store instead of
the origin. Store fills go through `waitUntil`, and every store failure falls
through to the origin.

`NardukDataSource` gains `'store'` for a value served with no upstream request.
This widens the union, so an exhaustive `switch` on `freshness.source` needs a
new case.
