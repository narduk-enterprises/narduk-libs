---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/narduk-devices': patch
'@narduk-enterprises/narduk-realtime': patch
---

Lint through `narduk-lint` with a checked-in `lint-budget.json` recording the
package's current warning counts. No runtime change; the release gate requires
a changeset for any changed package file.
