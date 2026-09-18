---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Thrown 4xx/5xx responses — including a 429 from `defineRateLimitedHandler` — now
carry `Cache-Control: private, no-store` and drop `CDN-Cache-Control`,
`Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `Cache-Tag`, `Expires` and
`Age`, even when the route had already set a cacheable profile (e.g.
`setCacheProfile(event, 'live')`) before throwing. Nitro's own error page
otherwise ships `Cache-Control: no-cache`, which Cloudflare Workers Cache
_stores_ and revalidates once an app turns on `"cache": { "enabled": true }`;
`no-store` / `private` are the documented opt-out. This is a safe precondition
for narduk-libs#435 (making `setCacheProfile`'s edge header actually hit) — do
not enable Workers Cache in a consuming app until this release.

The header-strip list that already backed the `preferences-cache` plugin
(narduk-libs#386) moved to a new framework-free
`runtime/shared/utils/shared-cache.ts` so the error path reuses it rather than
duplicating it; `preferences.ts` re-exports the same names it always has, so no
consumer import changes.

`@narduk-enterprises/create-narduk-app` only re-releases so its pinned
`@narduk-enterprises/narduk-core` version follows this patch
(`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no generator
behavior changes.
