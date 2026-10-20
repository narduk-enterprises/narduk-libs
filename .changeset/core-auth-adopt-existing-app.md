---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

An existing app can adopt narduk-core and narduk-auth on Postgres. `nardukCore.postgresSchema` (default `public`) puts every core and auth table in a named schema, so an app-owned `public.users` or `public.api_keys` of another shape is never touched (narduk-libs#1953). Three more opt-outs, each defaulting to today's behaviour (narduk-libs#1940): `nardukCore.csrf.enabled: false` turns the CSRF middleware off, `nardukCore.health: false` leaves `/api/health` to the app's own route, and `@nuxt/ui` is now a peer range (`>=4.7.1 <5`) instead of a pinned core dependency. With default options behaviour is unchanged for D1 and Postgres apps, with two things to know: an app that uses the UI modules (`coreModules` on) must now list `@nuxt/ui` itself, since core no longer pulls it in (generated apps already do), and `runtimeConfig.nardukCsrf.enabled` and `runtimeConfig.postgresSchema` are new keys. A hand-written Vitest alias for `#narduk-core/schema` that points at `pg-schema.ts` also needs `#narduk-core/postgres-schema` (apps that read `.nuxt/tsconfig.json` through `nuxtVitestAliases()` get it automatically).
