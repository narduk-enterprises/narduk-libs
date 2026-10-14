---
'@narduk-enterprises/create-narduk-app': patch
---

Generate Dependabot `cooldown` with `default-days` and `semver-major-days` of 1 (was 0), matching the generated `minimumReleaseAge: 1440`. With 0, Dependabot proposed versions under a day old and pnpm refused them, failing every npm update job. Existing files at cooldown 0 are now rewritten to the template.
