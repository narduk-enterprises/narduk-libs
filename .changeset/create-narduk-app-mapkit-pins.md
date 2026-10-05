---
'@narduk-enterprises/create-narduk-app': patch
---

Release the generator alongside the pending narduk-mapkit changesets (`mapkit-fit-region-to-viewport`,
`mapkit-point-no-stroke-at-zero`), which move a generator-pinned version without listing
create-narduk-app. Without it `release-plan:check` fails on main and on every pull request.
