---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

NeCommandPalette: a provider may resolve `{ items, notes }` (`NeCommandAnswer`) to return the rows it found together with a note for each source it could not read; notes render under the group heading, keep the section visible with no rows, suppress the "no results" state and are announced, and a partial answer is not cached. Sections and rows carry `data-ne-command-group` / `data-ne-command-item` hooks, and a `footnote` prop adds one line of context under the results.
