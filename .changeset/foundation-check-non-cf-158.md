---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check` items 1.1, 1.2, 1.4 and 1.5 are not-applicable when the app's only declared deployment target is not Cloudflare (narduk-libs#158). The checker reads `Config/project-lifecycle.json` `environments[].deploymentTargets[].provider`, or `Config/coolify-app.json` when there is no `Config/cloudflare-app.json`. A Worker that sets `worker.nitroPreset` (or `worker.framework`) to `none` is the same: 1.1 no longer fails a hand-rolled `src/index.ts` Worker that has no Nitro build. Item 1.3 still requires `manifests:validate`. Items 3.1/3.2 read `access.exposureClass` from `Config/coolify-app.json` when the Cloudflare manifest is absent, so a Coolify public site is still asked for narduk-seo and narduk-analytics.
