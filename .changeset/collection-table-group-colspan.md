---
'@narduk-enterprises/narduk-shell': patch
---

`NeCollectionTable`'s full-width cells (group headings, the empty row, the footer) now span only the columns that are kept in the stacked `columns` layout. A span over the dropped `phone: false` columns made the browser invent that many anonymous columns, and they split the free width with the primary column. Measured in operator-portal's grouped /projects at 375px: the name column went from 22px to 109px.
