---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Two foundation checks for the components-library plan (narduk-libs#260).
`narduk-app foundation:check:no-local-copy` (item 13) fails when an app depends
on a shared UI package and keeps its own copy of one of its components.
`narduk-app foundation:check:list-routes` (item 14) fails when a GET server
route reads pagination from its query without narduk-core's `parseListQuery`.
Each writes its own JSON artefact and uses the usual exit codes: 0 pass, 1 fail,
2 unknown. The README documents both.
