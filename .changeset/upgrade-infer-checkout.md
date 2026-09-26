---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` reads the checkout it is pointed at: root Nuxt app versus `apps/web`, the wrangler file that exists (`wrangler.json` or `wrangler.jsonc`, or `nativeManifests.wrangler`), a literal `devServer.port`, and `databaseBackend: none` when nothing binds D1. Migrate scripts are proposed only when the callee exists, and `build:ci` sets `NUXT_SESSION_PASSWORD` only for an auth app.
