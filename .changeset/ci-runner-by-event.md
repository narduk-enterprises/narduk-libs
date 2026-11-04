---
'@narduk-enterprises/create-narduk-app': patch
---

Generated private `ci.yml` no longer passes `runner:` to the shared workflow. Its empty default is the same linux-ci route, so nothing moves on the current pin. Once the pin reaches narduk-enterprises/workflows#241, the shared workflow sends scheduled, nightly, Dependabot, lane-automation and draft runs to the linux-ci-background tier by itself.
