---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Require sharp ^0.35.5 (GHSA-wq5f-xc86-pv6w, librsvg) and pin launch-editor's shell-quote to ^1.11.0 (GHSA-pqg4-j6r4-53mv), clearing the two advisories that turned `pnpm audit --audit-level high` red for every pull request.
