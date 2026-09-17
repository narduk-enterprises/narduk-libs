---
'@narduk-enterprises/create-narduk-app': patch
---

Patch release alongside the `@narduk-enterprises/narduk-uploads` patch (the
upload byte cap is now enforced while the body is read) so
`@narduk-enterprises/create-narduk-app` can refresh its pinned `narduk-uploads`
version in `src/manifest.ts`. `scripts/check-generator-release-plan.mjs`
requires a generator release whenever a package it pins changes version. No
generator behavior changes.
