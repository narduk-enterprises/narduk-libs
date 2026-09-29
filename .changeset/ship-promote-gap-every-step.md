---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app ship` now requires `GITHUB_TOKEN` (or `GH_TOKEN`) on every promote.yml step that runs `narduk-app deploy versions-promote`, including the wait step's `--dry-run`, and `pull-requests: read` on each such job. Only the command counts: a mention in a shell comment or error string does not. Before, one token line anywhere satisfied the preflight, so an app could ship and then have main's wait step refuse.
