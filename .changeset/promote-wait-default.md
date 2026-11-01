---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app deploy versions-promote` now waits up to 900 s for the version under `workflow_run` when `--wait-for-version` is not given, so a CI that finishes before the Workers Builds upload no longer exits `version-not-found`. A failed "Workers Builds" check-run (read with `GITHUB_TOKEN`) stops the wait and is named in the exit-3 detail. `--wait-for-version 0` looks once. narduk-libs#2116.
