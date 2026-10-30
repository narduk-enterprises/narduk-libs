---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core adds three opt-in options for published-data routes; callers that pass none see no change. `definePublishedDataHandler` takes `unavailableBody(error, event)`, which builds the whole 503 body for a failed read (a `private, no-store` 503 with the route's own error envelope) instead of the h3 error. A cache profile takes `sMaxAgeInCacheControl: true`, which writes `s-maxage` on `Cache-Control` next to `CDN-Cache-Control` for a contract keyed on `s-maxage`; it works inline, through `runtimeConfig.cache.profiles` and through `definePublishedDataHandler`. `readApproximateLocation(event, { includeCityRegion: true })` also returns `city` and `regionCode` when Cloudflare provides them (`regionCode` also comes from the `cf-region-code` header on the `cf-ip*` fallback). They close the gaps that kept riverstatus, lakestat-us and buoys on local copies.
