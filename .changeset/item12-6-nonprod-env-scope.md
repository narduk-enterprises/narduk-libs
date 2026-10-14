---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

foundation 12.6 compares `workers_dev`/`preview_urls` only where production can deploy from. Production always uploads the top level, because 12.1 fixes the command and `narduk-app deploy` flattens `env` away. A JSON wrangler `env.*` scope is now listed rather than compared when all of these hold:
- a `production` environments[] row exists;
- a non-production row names the scope through `workerEnv`;
- the scope deploys a different Worker name.

Every other scope is still compared. 12.6 now also fails a top level that sets neither flag, because Cloudflare's `true` default then ships to production, even when an env scope sets the flags.
