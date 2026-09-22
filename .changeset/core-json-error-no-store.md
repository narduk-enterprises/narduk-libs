---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

A thrown error answered as JSON now leaves `private, no-store`
(narduk-libs#493). For an `/api/*` or `.json` path, `Accept: application/json`,
a CORS fetch or curl, Nuxt hands the error to Nitro's own handler, which sent
`Cache-Control: no-cache` on every 404 and bypassed the `error-cache` plugin.
Workers Cache stores `no-cache`, so an app with `"cache": { "enabled": true }`
stored its API errors. A new prepended Nitro error handler,
`json-error-no-store`, answers those errors itself with Nitro's status and body
and `private, no-store`, and strips any CDN headers a route set before it threw.
HTML errors and `nuxt dev` are unchanged.
