---
'@narduk-enterprises/narduk-app-tools': patch
---

`db migrate-deployment --gate-verified` no longer lets unrelated jobs (E2E) block a deploy (operator-portal#3173).

- The gate check run's own status and conclusion decide, not the whole CI workflow run's. A finished gate check counts while other jobs of its run are still going, as long as it is a job of the run's current attempt. A check left from an earlier attempt while a re-run is in flight still reads as "still running".
- The merged-pull-request fallback accepts a pull request that merged behind the production branch when the migrations the deployment would apply are identical between the pull request head and the merge commit. That means each database's sources file, each source directory in the repository, and the lockfile for a package-provided source. It still refuses when any of these differ, when the head's gate check is red, missing or unreadable, and when a source cannot be pinned by repository content.
- New export: `deploymentMigrationPaths(plan, root)`. New optional `CiGate.migrationPaths`: without it, `assertCiGateGreen` still requires the whole tree to be identical.
