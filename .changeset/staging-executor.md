---
'@narduk-enterprises/narduk-app-tools': minor
---

`narduk-app deploy staging --sha <commit>` executes an enabled `deployment.staging` stage: it uploads the built staging bundle to `staging.workerName` tagged with the commit, deploys it at 100%, proves `https://<staging.hostname>` with the `liveProof` settings, and rolls staging back (exit 4) when the proof fails. `staging.wranglerConfig` optionally names a committed staging wrangler config, checked against the declared Worker, hostname and bindings. While staging is enabled, `deploy versions-promote` refuses production (exit 11, `staging-not-proven`) unless the staging Worker serves a version tagged with the same commit.
