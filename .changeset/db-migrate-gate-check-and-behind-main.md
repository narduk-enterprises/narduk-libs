---
'@narduk-enterprises/narduk-app-tools': patch
---

`db migrate-deployment --gate-verified` no longer lets unrelated jobs (E2E) block a deploy (operator-portal#3173).

- The gate check run's own status and conclusion decide, not the whole CI workflow run's. A finished gate check counts while other jobs of its run are still going, as long as it is a job of the run's current attempt. A check left from an earlier attempt while a re-run is in flight still reads as "still running".
- The merged-pull-request fallback accepts a pull request that merged behind the production branch when the paths that decide what is applied are the same directory or regular file at the pull request head and the merge commit. Those paths are:
  - the checked-in app manifest
  - the wrangler config
  - each database's sources file
  - each in-repo source directory
  - the lockfile for a pnpm registry package source or a workspace-linked package

  It still refuses when any of these differ, is untracked, or has untracked, ignored or edited files on disk. It also refuses a symlink or submodule on the way to or inside a compared path, and a red, missing or unreadable head check. A source git cannot pin (outside the checkout, behind a symlink, not installed, or installed from a directory) keeps the whole-tree rule.
- New export: `deploymentMigrationPaths(plan, root)`. New optional `CiGate.migrationPaths`: without it, `assertCiGateGreen` still requires the whole tree to be identical.
