---
'@narduk-enterprises/create-narduk-app': patch
---

The generated `promote-d1` and `preview-d1` "Preserve D1 recovery evidence, including on failure" uploads are report-only: `continue-on-error: true` and `retention-days: 3`. A GitHub artifact-quota refusal no longer fails that job after the migration step has already decided the result. The migration step stays fatal. The optional R2 `preserve-recovery` replacement is unchanged and still has no `continue-on-error`.
