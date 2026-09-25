---
'@narduk-enterprises/create-narduk-app': patch
---

Dependabot `safe`-lane merges now reach production. `dependabot-merge.yml` starts main CI with `GITHUB_TOKEN`, and a run started that way fires no `workflow_run`, so Promote never saw it (narduk-libs#787). The generated `ci.yml` gains a `promote-dispatch` job for exactly that case: a bot-dispatched run on `main`. After every CI job has passed, and only while the commit is still main's head, it dispatches `promote.yml` with `verified-sha`. The job waits on nothing. `docs/workers-builds.md` now shows the `workflow_dispatch` input and a `gate` job for the app-owned `promote.yml`. The gate promotes only main's head and, for a dispatched run, re-reads `ci / Required` on that commit. An app that hasn't adopted this gets a notice instead of a failure. `ci.yml` is pin-managed, so existing apps copy the job by hand.
