---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-app-tools: `foundation:check:coverage` sub-check 9.8 flags a file that
fetches `https://data.nard.uk` directly instead of through narduk-core's
`createNardukDataClient` / `fetchNardukDataJson` (narduk-libs#373). It fails
when narduk-core is a dependency and warns (`unknown`) otherwise. A file that
names either shared entry point, or only links to the origin, is not reported.
