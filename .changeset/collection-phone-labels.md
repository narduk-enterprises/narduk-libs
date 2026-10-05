---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

`NeCollectionTable`'s phone card names every value (#1704, narduk-libs#1400).
Below `stackBelow` in the default `cards` layout, the primary cell heads the
card and every other cell is one line of label and value: the column's `label`
(and `unit`), `aria-hidden` because the header already names the cell for a
screen reader, then the value (`data-ne-cell-label`, `data-ne-cell-value`). The
value track is `minmax(0, 1fr)`, so no cell is wider than its card. One divider
under each card separates the rows and the cells draw none. A cell with nothing
to say is dropped from the card: one whose value renders nothing, or whose only
element carries `data-ne-empty`, which the default em dash now does; an app
marks its own "no value" mark the same way. A missing word (`missingText`)
stays. The `columns` layout's markup is unchanged.
