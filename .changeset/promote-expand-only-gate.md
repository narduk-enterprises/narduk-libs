---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-app-tools': patch
---

The generated `docs/deployment/promote-d1.steps.yml` now starts with two
credential-free steps. They run `foundation:check:deployment` on the exact SHA
being promoted, and refuse to migrate unless sub-check 12.9 passes. Only 12.9 is
judged, so another sub-check's UNKNOWN does not block a promotion. Worker
rollback restores code, never a schema, so automating rollback beside the
migrate step is safe only with this check in front of it (#399). The
deployment-migrations runbook specifies the same ordering. It also names the
check as a precondition for any promote workflow that runs
`narduk-app deploy rollback` automatically.

Existing apps copied the template once. To adopt, paste the two new steps above
the dry-run step.
