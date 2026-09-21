---
'@narduk-enterprises/narduk-shell': patch
---

Bound `format.ts`'s `unitSupport` cache (behind `formatQuantity`), unlike the
`caches` map it sits beside. `unit` values come off live feeds such as USGS
(`cfs`, `ft3/s`) rather than a fixed code-defined set, so a feed emitting many
distinct or malformed unit strings grew the map without bound for the life of a
Worker isolate. It now shares the same `MAX_CACHE_ENTRIES` cap and
clear-on-overflow as its sibling (#287).

Pure bug fix, no public API change.
