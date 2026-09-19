---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add a vector-tile canvas overlay source to `./client`.

`createVectorTileOverlaySource` paints decoded vector tiles to a canvas and
returns the `imageForTile` function the async tile overlay and the layer
registry already take, so a dense network stays off MapKit's overlay list.
Decoded tiles are cached, so `setStyle()` repaints from memory without a refetch
or a re-decode. The decode step is injected, which keeps this entry free of
protobuf dependencies and lets an app decode in a worker.

`createPmTilesTileSource` and `createPmTilesFetchSource` read a PMTiles archive
over HTTP range requests, taking the reader and the `fetch` they use so tests
need no network. A missing tile, an empty tile and a failed read all resolve to
`null` and report through `onError`, instead of throwing into the map.
