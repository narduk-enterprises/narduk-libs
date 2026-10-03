---
'@narduk-enterprises/narduk-mapkit': patch
---

A vector tile overlay no longer leaves blank tiles after a zoom change. A read dropped or aborted because the map left its zoom resolves `null`, and MapKit keeps that `null` as an empty tile without asking again, so tile requests that alternate between two zooms (an iOS pinch, an animated region change) or a zoom that comes back left river tiles blank. Once requests have been quiet for `VECTOR_TILE_DROP_REFRESH_MS` (300 ms) after any drop, the overlay is swapped through its `restyleHost` after the new overlay's first image, so every displayed tile is asked for again from the decoded cache. Newest-first reads and abort savings are unchanged.
