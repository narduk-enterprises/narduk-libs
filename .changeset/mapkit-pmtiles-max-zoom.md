---
'@narduk-enterprises/narduk-mapkit': patch
---

`createPmTilesTileSource().getMaxZoom()` reads the header through the reader. It called a detached `PMTiles.getHeader`, which throws, so it always answered `undefined`: a vector overlay over a PMTiles archive never overzoomed and drew nothing, and hit nothing, past the archive's deepest zoom. A failed header read now reaches `onError`.
