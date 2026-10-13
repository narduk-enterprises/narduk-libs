---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Production builds no longer serve `/_openapi.json` by default. A public spec is a route map for scanners, so an app that wants it now opts in with `NUXT_OPENAPI_PRODUCTION=prerender` (or `true`) or `runtime`. An unrecognised value also serves nothing.
