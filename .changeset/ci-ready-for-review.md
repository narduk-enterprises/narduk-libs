---
'@narduk-enterprises/create-narduk-app': patch
---

Generated `ci.yml` runs on `ready_for_review`: the shared workflow defers its expensive validation on a draft, and marking the draft ready now re-runs it instead of leaving the check red until a push.
