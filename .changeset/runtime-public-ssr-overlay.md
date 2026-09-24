---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-platform': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Fill the SSR `__NUXT__` payload from Worker public bindings, so Workers Builds
no longer ships an empty `gaMeasurementId` / `posthogPublicKey` when the Worker
has the keys (buoys#133).

Workers Builds does not inject `wrangler.json` `vars` into `nuxt build`, and
Nuxt's own request-time overlay only maps `NUXT_PUBLIC_*` names. Apps that
wrote `process.env.GA_MEASUREMENT_ID || ''` shipped an empty page payload while
`/api/runtime/public` was correct.

**narduk-core**: a new `00-runtime-public` Nitro plugin runs
`applyRuntimePublicOverlay(event)` on every page request (not `/api/` or
`/_nuxt/`) before SSR. It writes the browser-only overlay keys
(`RUNTIME_PUBLIC_SSR_KEYS`: analytics keys and PostHog flags, `allowGeolocation`,
`twitterSite`, `seoSearchActionUrlTemplate`) onto the request's own
`runtimeConfig.public` clone. `previewSafeMode`, `deploymentTarget`, the URLs
and the auth keys keep their build values on the server, because the 5xx
sanitizer and narduk-auth read them from the same object; the client plugin
still applies the full overlay. Preview hosts still blank analytics, and
`analyticsPrivacy: 'strict'` is untouched. The overlay also accepts
`NUXT_PUBLIC_GA_MEASUREMENT_ID` / `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` /
`NUXT_PUBLIC_POSTHOG_HOST` after the short names, and the module seeds
`gaMeasurementId` / `posthogPublicKey` so Nuxt's native `NUXT_PUBLIC_*` overlay
has keys to fill.

**narduk-analytics** seeds `posthogPublicKey` and accepts the same
`NUXT_PUBLIC_*` aliases at build time. **narduk-platform** catalog notes,
**narduk-app-tools** README and the **create-narduk-app** runbook document that
`cf:runtime-var` is the contract and a `nuxt.config.ts` wrangler reader is not.

**Upgrade (Buoys and any app with the same workaround):** bump
`@narduk-enterprises/narduk-core` (and `narduk-analytics` if pinned), delete
the app-local `wrangler.json` reader, drop `NUXT_PUBLIC_GA_MEASUREMENT_ID` /
`NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` wrangler copies kept only as Nuxt aliases, and
keep the short names in wrangler `vars`.
