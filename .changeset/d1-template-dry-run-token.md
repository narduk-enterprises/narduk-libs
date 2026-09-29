---
'@narduk-enterprises/create-narduk-app': patch
---

The D1 promote template's "Require an eligible uploaded version" dry-run step now sets `GITHUB_TOKEN`, which the ship guard in `versions-promote` needs before its dry-run exit.
