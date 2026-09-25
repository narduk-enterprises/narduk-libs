---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

`NeDataTable` can make a missing cell read as a word instead of a fixed em dash. `missingText` on the table sets it for every cell, and `missingText` on a `NeDataColumn` (a string, or a function of the row) overrides it for that column. The text is drawn visible and `text-dimmed`, so sighted and screen-reader users read the same word ("unreported", "unset", "not claimed"). With neither set, the table keeps the em dash with "No value" for a screen reader, as before (#1059).
