---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': minor
---

narduk-core's CSP baseline now allows `https://p.nard.uk`, the estate PostHog proxy every narduk-analytics app is enrolled with, on `script-src` and `connect-src`. Before this, an app that enforced the strict preset (`security.headers: { enabled: true, enforce: true }`) blocked every PostHog request, because the preset resolves at build time and cannot read the deploy-time `POSTHOG_HOST` the legacy middleware adds (cloudflarestat-us#7). The legacy baseline lists it too, so the two stay identical. `baseline: 'self'` still drops it.

`create-narduk-app upgrade` now applies the enforced CSP preset to apps scaffolded before narduk-libs#1228 instead of only warning about foundation item 10. Two new units: `apps/web/nuxt.config.ts` gains `nardukCore.security.headers: { enabled: true, enforce: true }` when it states no `security.headers` at all, and `apps/web/package.json` gains the `nuxt-security` devDependency when the app has none (run `pnpm install` afterwards). An existing soak or opt-out is reported, never rewritten, and an analytics app on narduk-core 2.19.0 or older is held until narduk-core is bumped, since enforcing on that baseline would block PostHog.
