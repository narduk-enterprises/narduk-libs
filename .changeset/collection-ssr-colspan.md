---
'@narduk-enterprises/narduk-shell': patch
---

`NeCollectionTable` in the `phoneLayout: 'columns'` layout no longer paints
phantom columns on a phone before hydration (#1432). A full-width cell (a group
heading, the empty row, the footer) now spans the kept columns from the server
render on, and one filler cell per `phone: false` column, hidden below
`stackBelow` with those columns, carries the row to the edge above it. The span
no longer waits for a viewport measured on mount, so the first paint at phone
width already gives the primary column its width.
