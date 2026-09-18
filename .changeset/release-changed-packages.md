---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/narduk-devices': patch
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/narduk-realtime': patch
---

Lint through `narduk-lint` with a checked-in `lint-budget.json` recording the
package's current warning counts (narduk-mapkit also marks fire-and-forget
limiter calls in its tests with `void`). No runtime change; the release gate
requires a changeset for any changed package file.
