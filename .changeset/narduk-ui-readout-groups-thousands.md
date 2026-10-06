---
'@narduk-enterprises/narduk-ui': minor
---

`formatValue` and `formatDelta` group thousands, so `NsReadoutTile` (and the
range bar and level well, which call them) prints `1,055,144` where a 7-digit
measure used to print `1055144`. The grouping is fixed to `en-US`, so server and
first client render agree and hydration does not mismatch. `grouping: false` on
either formatter, or the new `grouping` prop on `NsReadoutTile`, keeps the plain
digits for a year-like value. A missing value still prints the em-dash (#1497).
