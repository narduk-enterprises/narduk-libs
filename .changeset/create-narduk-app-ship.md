---
'@narduk-enterprises/create-narduk-app': minor
---

Generated apps get `narduk-app ship` in place of `deploy-hotfix`: root `ship:check`, `ship:build` and `ship` scripts (the `ship` script reads the app's og-image and session build secrets and its deploy credential from nvault), a ship section in the generated deployment doc, and the promote job snippet grants `pull-requests: read` and passes `GITHUB_TOKEN` so `versions-promote`'s ship guard can prove a shipped PR landed.
