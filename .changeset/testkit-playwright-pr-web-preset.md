---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `@narduk-enterprises/narduk-testkit/playwright/config`, a Playwright preset
with `setup` / `pr` / `web` projects, `fullyParallel: true`, and `workers: 2`
(the measured default from the Buoys e2e-parallel-config experiment). Specs
declare a tier in the filename so an undeclared file is not collected by every
project. Viewport filtering is collection-time via project metadata.
`create-narduk-app` is a companion patch so the generator pin moves with the
testkit release.
