---
'@narduk-enterprises/create-narduk-app': patch
---

Bump the generated-app pin for `@narduk-enterprises/narduk-core` (and the
workspace dependents Changesets will move with it) so a fresh scaffold gets the
empty `colorMode.classSuffix` and the report-only CSP that omits
`upgrade-insecure-requests`. The generator templates do not set `classSuffix`
themselves.
