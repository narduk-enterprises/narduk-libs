---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app deploy` now points a refused local deploy at runner upload (merge to main; CI builds once and the linux-deploy runner uploads the version, then the app's promote workflow promotes it) instead of steering agents to Workers Builds. The `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` recovery opt-in and the Workers Builds attestation for legacy apps are unchanged.
