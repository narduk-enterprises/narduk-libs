---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app ship --token-env <NAME>` reads the deploy token from a standard worker-deploy persona key (`<APP>_WORKER_DEPLOY_CF_TOKEN`). Generated apps' `ship` script now names the persona's real nvault config, `narduk-enterprises-<app>-worker-deploy`, instead of a `-deploy` config that no new app has.
