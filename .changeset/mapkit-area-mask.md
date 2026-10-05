---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

`createAreaMaskTileSource({ createCanvas, layer })` is a tile image source that
covers everything outside some areas: a cut-out for a page about one state.

- The layer is `{ index, ids?, fillColor, fillOpacity?, edge? }` over the same
  `createVectorTileAreaIndex` the outline source and the pointer use. `ids`
  picks the areas left uncovered (default every area); `edge` draws a line round
  each cut-out, over the mask.
- One even-odd fill of the tile's rectangle plus the areas' rings, so every part
  of a multi-polygon is cut out (Michigan's peninsulas, Hawaii's islands, the
  Aleutians either side of the antimeridian). Shapes are also tried one world
  east and west for a map that repeats the world.
- A tile no area reaches is one flat image shared per size. Place the layer
  above the network in a `MapKitLayerRegistry` and the network and the basemap
  show only inside the areas.
