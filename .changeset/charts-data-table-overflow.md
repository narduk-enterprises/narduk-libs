---
'@narduk-enterprises/narduk-charts': patch
---

The off-screen data table that `show-data-table` renders no longer widens its
container (narduk-libs#296). The visually-hidden class now sits on a wrapping
`div` instead of the `<table>`. `overflow` does not apply to a table box, and an
auto-layout table grows to its content's width whatever its declared `1px`. In a
320px box the line and bar charts' hidden tables used to reach 669px, and they
pushed Buoys' 390px station page out to 652px. The table and its caption are
unchanged, so screen readers still announce it as a table. Buoys can turn
`show-data-table` back on.
