---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-platform': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Apply Worker public bindings to Nuxt SSR `__NUXT__` so Workers Builds no
longer bakes empty `gaMeasurementId` / `posthogPublicKey` when wrangler vars
exist (buoys#133 / PR #136).

Workers Builds does not inject `wrangler.json` `vars` into `nuxt build`.
Nuxt's native request-time overlay only sees `NUXT_PUBLIC_*` names. Apps
that wrote `process.env.GA_MEASUREMENT_ID || ''` therefore shipped an empty
homepage payload while `/api/runtime/public` was correct.

**narduk-core** now runs `applyRuntimePublicOverlay` on every request
before SSR (same overlay as `/api/runtime/public`). Short Worker names and
optional `NUXT_PUBLIC_*` aliases both work. Preview hosts still blank
analytics. Do not read `wrangler.json` from `nuxt.config.ts`.

**Upgrade (Buoys and any app with the same workaround):** bump
`@narduk-enterprises/narduk-core` (and `narduk-analytics` if pinned). Then
delete the app-local wrangler.json reader, drop duplicated
`NUXT_PUBLIC_GA_MEASUREMENT_ID` / `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` wrangler
copies, and leave those `runtimeConfig.public` keys unset or empty at build
time. Keep the short names in wrangler `vars`.
