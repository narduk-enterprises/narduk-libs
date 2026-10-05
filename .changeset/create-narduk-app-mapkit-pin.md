---
'@narduk-enterprises/create-narduk-app': patch
---

Move the generator's `@narduk-enterprises/narduk-mapkit` pin to the release that carries the
`fitMapKitRegionToViewport` geometry helper and the canvas point layer zero-stroke fix. The
mapkit changesets (#1469, #1470) landed without this entry, which turned the
`release-plan:check` contract red on main and withheld every release, including
`@narduk-enterprises/narduk-analytics` 1.26.2 (#1310).
