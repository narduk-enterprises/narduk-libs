---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/narduk-timeseries': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add the narduk-shell data-table family — `NeDataTable` (UTable preset with
column groups, units, tabular numerals, the missing dash, day/group rows, a
pinned first column, the phone column-set switch, the break row, and loading),
`NeSortHeader`, `NeCsvDownload`, plus `toCsv` / `parseSort` from the package
root — and extend `NePager` with `pageSizes`, `mode` (`pages` | `more` |
`auto`), `moreStep`, `maxLimit` and `update:limit`. narduk-timeseries gains
`bucketReadings` (1h / 3h / 1d min/avg/max; missing is `null`, not `0`).
create-narduk-app is patched because it pins narduk-shell (narduk-libs#528).
