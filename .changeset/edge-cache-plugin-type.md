---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: `holdEdgeCacheWrites` is typed as Nitro's `NitroAppPlugin`, so `defineNitroPlugin(holdEdgeCacheWrites)` typechecks in an app (2.40.0's looser hook shape returned `unknown`, which Nitro's `afterResponse` rejects). It now finds the request's `waitUntil` through `resolveWaitUntil`, which also reads the Cloudflare context.
