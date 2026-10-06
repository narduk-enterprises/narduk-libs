---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app deploy versions-promote` orders by commit, not by upload (#1375). A commit that production's commit already contains is skipped (`outcome: superseded`, exit 0, `skipped: live <sha> already contains <sha>`, no traffic moved) instead of rolling production back when two merges' CI finish out of order; a descendant promotes whatever order the versions were uploaded in, and upload order is only the fallback when git and GitHub cannot say. `--allow-rollback` is the explicit way to promote an ancestor. Under `GITHUB_OUTPUT` the step writes `outcome`, `superseded`, `version_id` and `previous_version_id`, so a workflow can skip its live proof after a skip (`if: steps.promote.outputs.superseded != 'true'`). The double-dispatch recovery hint prints the `gh workflow run` command only when the checkout's `promote.yml` declares both the `verified-sha` and `version-id` inputs, and otherwise only the by-hand command (#1543). The generated runbook documents both.
