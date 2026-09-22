---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check:coverage` gives each shared capability one of three states:
`absent`, `adopted` or `forked` (#620). A capability is `forked` when an app
pins the package and also carries its own copy of the package's internals. It is
reported with its files and line count, and it no longer counts as adopted. Item
9.1 names it but does not fail, because some forks are deliberate and tracked.

The signal is opt-in per capability, through `forkStems` in the generated
catalog. Today only `narduk-mapkit` declares one (`mapkit`). A file counts when
a directory segment of its path, or its own name, equals the stem, and it
imports no package named for that stem.

Inventory rows gain `state` and `fork`. `adopted` is now true only for
`state: "adopted"`.
