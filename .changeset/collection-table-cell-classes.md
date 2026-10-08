---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

`NeCollectionTable` cells, header cells and rows now carry a short role class (`ne-cell`, `ne-cell--num`, `ne-cell--pri`, `ne-head`, `ne-row`, …) and the layout, including the phone card, ships once as `@layer components` rules in the component's stylesheet. A 300-cell table's class attributes drop from about 522 to 25 bytes per cell (156,600 to 7,500 bytes) and its markup from 206 KB to 46 KB. Same look, props, slots and behaviour; the cell's utilities (`max-md:flex …`, `px-3 py-2 …`) are gone, so an app test that asserted them should assert the role class instead.
