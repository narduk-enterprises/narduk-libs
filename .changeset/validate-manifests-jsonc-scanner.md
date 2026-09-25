---
'@narduk-enterprises/create-narduk-app': patch
---

The generated `apps/web/scripts/validate-manifests.mjs` strips `wrangler.jsonc` comments and trailing commas with a string-aware scanner instead of a regex, so a `"*/15 * * * *"` cron no longer pairs with the `"**/*.mjs"` glob to crash `manifests:validate`. It also sorts the wrangler crons before comparing them with the manifest's (#914). The file is a seed: an existing app picks up the fix by copying the new script from a fresh scaffold.
