---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

An existing app can adopt narduk-core and narduk-auth on Postgres. `nardukCore.postgresSchema` (default `public`) puts every core and auth table in a named schema, so an app-owned `public.users` or `public.api_keys` of another shape is never touched (narduk-libs#1953). Three more opt-outs, each defaulting to today's behaviour (narduk-libs#1940): `nardukCore.csrf.enabled: false` turns the CSRF middleware off, `nardukCore.health: false` leaves `/api/health` to the app's own route, and `@nuxt/ui` is now a peer range (`>=4.7.1 <5`) instead of a pinned core dependency. With default options nothing changes for D1 or Postgres apps.
