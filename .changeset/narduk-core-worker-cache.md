---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `withWorkerCache`, a bounded, versioned, completed-value Worker data cache
for hot reads (`@narduk-enterprises/narduk-core/server/utils/workerCache`,
narduk-libs#1716, extending #1268). SSR pages call the app's API in-process, so
they bypass Workers Cache and re-ran the handler's D1 reads on every view; this
caches the value inside the handler instead: isolate memory (bounded by bytes
and entries) then Workers Cache (public scope) then `build()`, keyed by an
app-supplied version so a write is visible on the next request with no purge. It
keeps completed serializable values only, never shares an in-flight promise
between requests, owns its background refresh with `waitUntil`, never lets an
older refresh overwrite a newer value, and falls through on Cache API errors.
`readCacheVersion`, `bumpCacheVersion` and `prepareCacheVersionBump` keep the
version in the existing `kv_cache` table (no new migration). The README gains a
"Worker data cache" section on choosing between `setCacheProfile`,
`withWorkerCache` and `withKVCache` / `withD1Cache`. Purely additive.
