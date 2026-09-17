---
'@narduk-enterprises/create-narduk-app': patch
---

Fix the generated deployment runbook's promote snippet, which told every new app
to promote the wrong commit (narduk-libs#451 defect 2).

The snippet passed `--sha "$GITHUB_SHA"`, but the promote job runs on
`workflow_run`, where `GITHUB_SHA` is the default branch's head at trigger time
rather than the commit whose run completed -- so a commit that never passed
`ci / Required` could reach production. The runbook now shows a `workflow_run`
workflow excerpt binding `VERIFIED_SHA` to
`${{ github.event.workflow_run.head_sha }}`, uses it for both the promote and
the live proof, and states why `$GITHUB_SHA` is wrong there. It also records
that the `--sha` lookup is bounded by `--max-versions` rather than capped at
ten, and that a lookup finding nothing exits 3 and must be a red job.
