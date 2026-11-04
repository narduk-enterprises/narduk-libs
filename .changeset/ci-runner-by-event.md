---
'@narduk-enterprises/create-narduk-app': patch
---

Generated private `ci.yml` no longer passes `runner:` to the shared workflow: its empty default is the same linux-ci route, and the shared workflow now sends scheduled, nightly, Dependabot, lane-automation and draft runs to the linux-ci-background tier by itself (narduk-enterprises/workflows#241).
