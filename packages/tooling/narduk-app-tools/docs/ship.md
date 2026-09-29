# `narduk-app ship`

The one fast path from a committed feature branch to production. No mode to
enter, no custody record, nothing to restore afterwards.

```bash
nvault run --project cloudflare --config <app>-deploy -- pnpm exec narduk-app ship -m "what changed"
```

1. **Commit.** A dirty tree ships only with `-m` (commits everything). Refuses
   on the production branch or a detached HEAD.
2. **Containment.** HEAD must contain `origin/<productionBranch>` _and_ the
   commit production serves right now. A squash-merged commit counts: git merges
   it into HEAD and nothing changes. This is the whole anti-clobber rule.
3. **Checks and build, concurrently.** `ship:check` (fallback `hotfix:check`)
   and `ship:build` (fallback `hotfix:build`). Keep `ship:check` to changed-file
   lint + typecheck; CI runs the full suite on the PR.
4. **Artifact gate.** The build left HEAD and tracked files untouched, produced
   `.output/`, the optional `ship:assert` script passes, and no credential value
   appears in public assets.
5. **Publish.** Upload tagged with the SHA and `narduk-app ship <branch> <id>`,
   promote 100% only if production did not change meanwhile.
6. **Prove, or roll back.** `verify --live` against the manifest's production
   hostname (or `--base-url`). A failed proof redeploys the previous version and
   exits 3.
7. **Land it.** Push the branch, open (or reuse) its PR, arm squash auto-merge.
   `--no-pr` skips this.

Until that PR merges, `narduk-app deploy versions-promote` refuses to promote a
main commit that does not contain the shipped one (exit 10,
`ship-not-contained`), so a merge to main can never undo a ship.

| Exit | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| 0    | Serving, proven, PR armed (or `--no-pr`).                                     |
| 1    | Refused before upload. Production unchanged.                                  |
| 3    | Promoted, proof failed, previous version serves again.                        |
| 4    | Serving and proven; push/PR failed. Land the branch by hand.                  |
| 5    | Proof failed and the rollback did not take. Run `narduk-app deploy rollback`. |

Not in v1: D1 migrations. A change under a `deployment.migrations` source
directory refuses; land it through normal delivery. First ship onto a version
with no commit tag needs `--adopt` once.
