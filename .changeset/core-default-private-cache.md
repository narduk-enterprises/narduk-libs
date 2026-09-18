---
'@narduk-enterprises/narduk-core': minor
---

A response that leaves the app with no cache posture now ships
`Cache-Control: private` (narduk-libs#435, step 1). SSR pages, API JSON, and a
returned `Response` without its own header all get it. Any explicit posture wins
unchanged: `Cache-Control`, `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`,
`Surrogate-Control` or `Expires` from `setCacheProfile`, `setResponseHeader`,
route rules, cached handlers, or the returned `Response`. Build assets under
`app.buildAssetsDir` are left alone, and thrown errors stay `private, no-store`.
A route that relied on having no `Cache-Control` to be stored by a shared cache
must now say so with `setCacheProfile`.
