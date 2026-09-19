---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Decode vector tiles, off the main thread, behind a new `./vector-tiles` entry.

`createMvtDecoder` reads Mapbox Vector Tiles with `@mapbox/vector-tile` and
`pbf`, and `serveVectorTileDecoder` hosts it in a worker that
`createWorkerDecoder` (in `./client`) talks to, correlating replies by id and
transferring buffers both ways so nothing is copied. The protobuf dependencies
are reachable only from `./vector-tiles`, so a consumer of `./client` never
bundles a parser; a test walks the import graph and fails if that changes.

A decoded tile is now columnar -- an `Int16Array` of coordinates plus two
`Uint32Array` indexes -- rather than an object per point, which is the
difference between a 256-tile cache retaining about a gigabyte and retaining
about a hundred megabytes. `buildDecodedVectorTile` packs one,
`decodedVectorTileBytes` and the new `cacheBytes` measure what is retained, and
`vectorTileFeatureCount` reads the feature count back.

Tile bytes are posted as a tight buffer, so a `Uint8Array` that views part of a
larger allocation decodes correctly and its parent buffer is not detached.
Requests for an address already in flight join that read instead of starting a
second one, and `cacheBytes` now counts an estimate of the property payload
rather than geometry alone.
