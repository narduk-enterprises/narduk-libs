---
'@narduk-enterprises/narduk-app-tools': patch
---

`versions-promote --sha` takes the one `Runner upload <sha>` version when a
Workers Build uploaded the same commit too, and reads that message as a `main`
build, so an app moving to the shared runner upload promotes without
`--version-id` or `--any-branch` (agent-infrastructure#4795). It needs the full
commit SHA; a re-run attempt that uploads a second runner version of a commit
still refuses, and `--version-id` names the one to take.
