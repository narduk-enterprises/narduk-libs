# `narduk-app ship`

The one fast path from a committed feature branch to production. No mode to
enter, no custody record, nothing to restore afterwards.

```bash
nvault run -p cloudflare -e prd -c narduk-enterprises-<app>-deploy -- pnpm exec narduk-app ship -m "what changed"
```

1. **Branch.** Refuses on the production branch or a detached HEAD. A dirty tree
   ships only with `-m`, which commits everything (untracked files included)
   once the checks below that need no build have passed. `--dry-run` never
   commits.
2. **Containment.** HEAD must contain `origin/<productionBranch>` _and_ the
   commit production serves right now: the whole anti-clobber rule. Local git
   answers first (ancestry, or a squash merge that git merges into HEAD with no
   change). Otherwise GitHub answers: the served commit is an ancestor, or a
   merged PR carrying it landed in HEAD's history. Nothing is fetched into your
   clone.
3. **Checks and build, concurrently.** `ship:check` (fallback `hotfix:check`)
   and `ship:build` (fallback `hotfix:build`). Keep `ship:check` to lint,
   typecheck and fast unit tests; CI runs the full suite on the PR.
4. **Artifact gate.** The build left HEAD and tracked files untouched, produced
   `.output/`, the optional `ship:assert` script passes, and no credential value
   appears in public assets.
5. **Publish.** Push the branch first, so the serving commit is on GitHub. Then
   upload tagged with the SHA and `narduk-app ship <branch> <id>`, and promote
   100% only if production did not change meanwhile.
6. **Prove, or roll back.** `verify --live` against the manifest's production
   hostname (or `--base-url`). A failed proof, or a promote that errors after
   traffic may have moved, redeploys the previous version as a
   `narduk-app rollback` deployment and exits 3.
7. **Land it.** Open (or reuse) the branch's PR and arm squash auto-merge.
   `--no-pr` skips this; merge the branch soon.

Until that PR merges, `narduk-app deploy versions-promote` refuses to promote a
main commit that does not contain the shipped one (exit 10,
`ship-not-contained`), so a merge to main can never undo a ship. Once the PR
merges, every later main commit contains it, review fixes included. The promote
step reads GitHub, so an app that ships gives its promote job
`pull-requests: read` (the squash-merge lookup) and the promote step
`GITHUB_TOKEN: ${{ github.token }}`; ship refuses until `promote.yml` has both.

| Exit | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 0    | Serving, proven, PR armed (or `--no-pr`).                                           |
| 1    | Refused before upload. Production unchanged.                                        |
| 3    | Promoted, proof or promote failed, previous version serves again.                   |
| 4    | Serving and proven; opening the PR failed. Open and merge it by hand.               |
| 5    | Proof failed and the rollback did not take. Run the printed `deploy rollback --to`. |

Not in v1: D1 migrations. A change under a `deployment.migrations` source
directory refuses; land it through normal delivery. The first ship onto a
version with no commit tag needs `--adopt` once; `--adopt` never overrides a
tagged version HEAD does not contain.
