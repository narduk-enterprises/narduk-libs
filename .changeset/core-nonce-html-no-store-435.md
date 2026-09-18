---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

SSR HTML is never shared-cache storable on an app that serves the nonce CSP
(`nardukCore.security.headers` in `enforce` or `report-only` mode), because
nuxt-security writes one per-request nonce into both the HTML and the CSP header
and an edge cache would replay it to every visitor (narduk-libs#435).
`setCacheProfile` refuses a cacheable profile on a page render with the new
`nonce-csp-html` suppression reason, and a new `nonce-csp-cache` Nitro plugin
pins `Cache-Control: private, no-store` on the final `text/html` response and
strips `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`,
`Cache-Tag`, `Expires` and `Age` however they got there. JSON API routes and
Nuxt `_payload.json` responses keep their profile and stay edge-cacheable. In
development, a page that asked for a cacheable profile logs one warning per
path.

`@narduk-enterprises/create-narduk-app` only re-releases so its pinned
`@narduk-enterprises/narduk-core` version follows this patch
(`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no generator
behavior changes.
