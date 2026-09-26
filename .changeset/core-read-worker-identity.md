---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `readWorkerIdentity(event)`, which reports the deployed source revision and the Worker version from the `version_metadata` binding (default `CF_VERSION_METADATA`), and let `/api/health` surface it through `runtimeConfig.nardukHealth.identity` (app-named response headers, and an optional `identity` body field) so apps stop overriding the route to add deploy identity (#1022).
