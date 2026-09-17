---
'@narduk-enterprises/narduk-core': patch
---

Restrict the canonical-host redirect to top-level document navigations, and
retire the duplicate canonical-redirect middleware.

`00-canonical-host` redirected every `GET`/`HEAD` with a `308`, including
`/api/**` and `/_nuxt/**`. On any non-canonical hostname — a `workers.dev`
preview, a per-version preview URL, a branch alias — that turned every
same-origin `fetch()` into a cross-origin redirect the browser refuses for want
of an `Access-Control-Allow-Origin` header, while the canonical host still ran
the handler and paid its cost (a wasted Apple MapKit token mint and rate-limit
slot in the case that found it). The redirect now fires when `Sec-Fetch-Dest` is
`document`, is skipped when it is anything else, and, for a request carrying no
fetch metadata at all, keeps canonicalising page paths for crawlers while never
redirecting `/api/**` or `/_**`. Auth routes reached by navigation —
`/auth/callback`, `/auth/confirm`, a provider redirect into
`GET /api/auth/session/exchange` — still canonicalise before setting a cookie.

`runtime/server/middleware/canonicalRedirect.ts`, a second auto-registered
canonical-host middleware that redirected with `301` and gated on
`import.meta.dev`, no longer sits in the scanned middleware tree. The import
path `@narduk-enterprises/narduk-core/server/middleware/canonicalRedirect` still
resolves, as a deprecated alias exporting the one live handler, so apps that run
the core middleware chain by hand keep compiling.
