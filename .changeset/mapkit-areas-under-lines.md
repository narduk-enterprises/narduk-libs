---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

A vector tile overlay paints areas beneath its lines (narduk-libs#1345 L12).

- `source.setAreas({ index, style })` paints GeoJSON Polygon and MultiPolygon
  shapes (flood-alert areas) into the same tile image as the network, first, so
  the lines sit on top. MapKit JS gives an app no dependable order between its
  vector overlays and a tile overlay; painting into the tile image is the order
  that holds. It repaints from the decoded cache and swaps the overlay through
  the restyle host, like `restyle`.
- `createVectorTileAreaIndex(inputs)` projects every vertex once. It answers
  `hitTest` and `hitTestAll` (even-odd across rings, so a hole is outside), the
  `boundsOf` an area, and lists the inputs with no readable shape in `skipped`.
  `source.hitTestArea` and `hitTestAreas` answer the same for the areas the
  style draws, synchronously and from memory.
- A tile no area reaches is painted exactly as before, in the worker when there
  is a `painter`. A tile an area reaches is composed on the main thread: the
  areas, then the painter's lines over them. A tile the archive has no lines for
  still gets its areas.
- `paintVectorTileAreas`, `vectorTileAreasReach` and the `VectorTileArea*`
  types are exported. `paintVectorTile` takes an `areas` option, and
  `VectorTileCanvasContext` gains four optional members (`closePath`,
  `drawImage`, `fill`, `fillStyle`) that only the area pass reads.
