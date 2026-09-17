---
'@narduk-enterprises/create-narduk-app': patch
---

Bump the pinned `@narduk-enterprises/narduk-testkit` version to track its new
`server/handlers` handler test harness (narduk-libs#380). No generator behavior
changes — this only keeps the generator's own release in step with the
release-plan guard's generator-pin rule
(`scripts/check-generator-release-plan.mjs`), which requires a companion release
whenever a changeset moves a package the generator pins by version literal.
