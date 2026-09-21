---
'@narduk-enterprises/create-narduk-app': minor
---

A new app's `apps/web/wrangler.jsonc` enables Workers Cache
(`"cache": { "enabled": true }`), so `setCacheProfile`'s `CDN-Cache-Control` and
`Cache-Tag` bind at the edge instead of being inert headers advertising a TTL
the app does not have (narduk-libs#435). Without the block Cloudflare invokes
the Worker on every request and never stores the response, which is what Buoys
shipped: correct cache headers and no `Cf-Cache-Status`.

On by default is safe because the narduk-core this generator pins keeps
uncacheable responses out of a shared cache: thrown 4xx/5xx/429 are
`private, no-store` (narduk-libs#429), nonce-CSP SSR HTML is too, and a route
that picks no profile at all is `private` rather than left to Cloudflare's
heuristic. `foundation:check` item 12.7 fails the block against an older
narduk-core, so an app that downgrades core is told rather than silently storing
error pages. `cross_version_cache` is left unset: a deployment partitions the
cache by Worker version, and sharing across versions wants an app-specific
reason.

Enabling storage is a repository fact, not a live one. Prove a real hit with
`narduk-app verify --live <production-url> --edge-cache-path <route>`; a
`*.workers.dev` preview cannot show one.

Existing apps are unaffected: `apps/web/wrangler.jsonc` is not an `upgrade`
managed target, so `create-narduk-app upgrade` does not add the block to an app
that already exists. Item 12.7 reports those apps `not-applicable` and says the
edge headers are inert.
