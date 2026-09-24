---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

`NeDataTable` owns its sideways overflow and floors width-less columns (narduk-libs#684, proven in operator-portal's `CollectionTable`). `UTable`'s root is now the named scroll box (`data-ne-data-table-scroll`), and it and the outer wrapper carry `min-w-0 max-w-full`, so one long unbreakable string scrolls the table, never the page, even inside a flex or grid parent. `NeDataColumn` gains an optional `width` (any CSS length, set on the header cell); once any shown column declares one, the table takes `min-width: max(100%, calc(<each width, or 200px for a width-less column> + …))` from `sm` up through `--ne-data-table-min`, so every width-less column keeps at least 200px and the box scrolls instead. A table that declares no widths renders as before; `stickyHeader: 'page'` keeps no scroll box and no floor.
