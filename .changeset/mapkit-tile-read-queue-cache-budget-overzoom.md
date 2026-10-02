---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

Vector tile overlays get a read queue, a byte budget and overzoom
(narduk-libs#1345 L5/L6/L4). Tile reads go through a bounded queue
(`readConcurrency`, default 6) served newest first; a read for a zoom the map
has left is dropped before it starts or aborted through the `AbortSignal`
`tileBytes` already accepts, and is neither reported to `onError` nor cached.
The decoded-tile cache evicts least-recently-used tiles by total decoded bytes
(`cacheBytes`, default 64 MiB, `Infinity` to disable) alongside the `cacheSize`
count cap; a tile larger than the whole budget still paints but is not retained.
`maxDataZoom` (defaulting to the archive's max zoom through the new `archive`
option and `PmTilesTileSource.getMaxZoom`) paints tiles above it from the
ancestor at that zoom, scaled and clipped into the child, with one read and one
decode shared by every descendant; the class-table key follows the display zoom
and `hitTest` answers from the ancestor. `createPmTilesTileSource` no longer
reports an aborted read to `onError`. Every new option is optional.
