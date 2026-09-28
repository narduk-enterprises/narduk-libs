---
'@narduk-enterprises/create-narduk-app': patch
---

Private apps' CI now starts. The shared-workflow caller grants `actions: read` and `pull-requests: write` beside `contents` and `packages`: the pinned workflow's preview job asks for `pull-requests: write` and its reuse-plan and e2e-plan jobs ask for `actions: read`, and GitHub rejects a caller that grants less with a zero-job `startup_failure`. `upgrade` adds the missing grants to an existing caller whenever it touches `ci.yml`, keeps every grant the app already wrote, and reports rather than widens a grant the app set narrower or a one-line `permissions:` value.
