---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

foundation 12.6 compares `workers_dev`/`preview_urls` only where production can deploy from. A wrangler env scope that a non-production `environments[]` row names through `workerEnv` is now listed in the detail and no longer compared with the production declaration. An env scope that no row names is still compared and still fails. 12.6 now also fails when only a non-production scope sets a flag and production silently inherits Cloudflare's `true` default.
