---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: shared client caching, extracted from stonx.

- `app/resource-cache`: `createResourceCache`, a keyed cache for Pinia stores. It shares one in-flight read per key, serves fresh data within `staleMs`, backs off with `retryMs`, and makes `invalidate` retire reads already out. Entries are tagged with the actor epoch and id, and hydrated SSR entries count as fresh. It also adds `createResourcePoller`: one visibility-aware timer per key, however many components poll it.
- `app/cached-store`: `defineCachedStore`, which wires the cache to Pinia and Nuxt hydration, and `useResourceIdentityStore`, which retires reads on an identity change.
- `app/server-prefetch`: `onHydrationSafeServerPrefetch`, a server prefetch that keeps `useId` equal across hydration (stonx#1356).
- `useIntervalRefresh` gains `pauseWhenHidden`: no ticks from a hidden tab, and one catch-up read on return. The default is unchanged.
- `server/edge-cache`: `createEdgeCache`, the Cache API tier for code with no request event. Its background puts are held by `holdEdgeCacheWrites` through `waitUntil`, or by the request's own `waitUntil` when it is passed an event. `server/edge-cache-storage` is a Nitro `cache` storage driver on the same tier.

None of the new names is auto-imported.
