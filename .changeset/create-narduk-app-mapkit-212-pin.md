---
'@narduk-enterprises/create-narduk-app': patch
---

Bump the pinned `@narduk-enterprises/narduk-mapkit` version to 2.1.2, so a newly
generated app starts on the release that builds a late-mounted `<AppMapKit>`
rather than on 2.1.1. No generator behavior changes — this only keeps the
generator's own release in step with the release-plan guard's generator-pin rule
(`scripts/check-generator-release-plan.mjs`), which requires a companion release
whenever a changeset moves a package the generator pins by version literal.
