---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/narduk-mapkit-nuxt': minor
'@narduk-enterprises/create-narduk-app': patch
---

Answer a tap on a painted vector tile, and wire the overlay to a Vue scope.

`source.hitTest({ coordinate, zoom, tolerancePx })` returns the nearest feature
within a screen-pixel radius, with the properties the archive carried. It reads
only tiles the cache already holds, so it is synchronous and can answer inside a
gesture; a tap on an undrawn tile misses rather than fetching. Distance is
measured to the nearest point on a segment, not to a vertex, and the probe
reaches into neighbouring tiles when it lands within the tolerance of an edge --
wrapping at the antimeridian, stopping at the poles -- so a river drawn a pixel
inside the next tile is still tappable. `projectToTilePoint`, `hitTestTile` and
`hitTestNeighbours` are exported for callers that hold their own tiles.

`useMapKitVectorTiles()` in the Nuxt module builds the PMTiles reader and the
overlay source, rebuilds them when the archive url changes, repaints a style
change from the decoded tiles rather than refetching, and terminates the decoder
worker with the Vue scope. The worker factory and the `pmtiles` reader stay the
app's, because a published worker chunk is the one thing Vite, webpack and Nuxt
do not agree on.

Two client interfaces were also corrected against the browser types they stand
in for: `VectorTileCanvasContext.strokeStyle` was too narrow for a real
`CanvasRenderingContext2D`, and `VectorTileWorkerPort.postMessage` was declared
so that a real `Worker` could not satisfy it. Both are now proven assignable by
typecheck-time tests.
