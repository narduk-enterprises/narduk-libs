---
'@narduk-enterprises/narduk-shell': minor
---

`NeCollectionTable` takes `cardDensity: 'comfortable' | 'compact'` (default `'comfortable'`, so existing tables render unchanged). `compact` keeps every column on a phone card but runs the cells on as wrapped inline label-value pairs under the full-width primary cell, with no divider between them, instead of one line per column. It is CSS on the root's new `data-ne-card-density` attribute (#1777).
