---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-app manifests validate` and `validateCloudflareManifest`: the wrangler ↔
`Config/cloudflare-app.json` parity check (bindings and crons as sorted sets,
`deployment.accountId`, `workersDev`/`previewUrls`) that apps carried as their own
drifted `validate-manifests.mjs` copies, parsed with `jsonc-parser` (#996).
