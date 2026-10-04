---
'@narduk-enterprises/narduk-shell': patch
---

`NeCollectionTable`'s `phoneLayout: 'columns'` now fits a phone. A dropped (`phone: false`) column hides its `<col>` along with its cells, so the next cell no longer slides into that column's width. The table also stays `table-fixed`, so a truncating cell shrinks to the width that is left instead of pushing the table past the screen. Measured in operator-portal /products at 375px: the table was 381px wide in a 341px panel with Health clipped, and now fits at 341px.
