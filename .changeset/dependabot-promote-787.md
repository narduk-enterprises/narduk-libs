---
'@narduk-enterprises/create-narduk-app': patch
---

Generated `dependabot-merge.yml` now waits for the `GITHUB_TOKEN`-dispatched main CI run and starts `promote.yml` with that SHA. GitHub does not emit `workflow_run` after a `GITHUB_TOKEN` dispatch, so Dependabot merges reached `main` and never production (narduk-libs#787). App-owned `promote.yml` must accept `workflow_dispatch` with `verified-sha`; the generated `docs/workers-builds.md` excerpt shows the `on:` block.
