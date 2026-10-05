---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Three generic pieces for a national river map: area outlines, a quiet area label
on hover, and a flow pulse along a chosen path of a vector tile overlay.

- `createAreaOutlineTileSource({ createCanvas, layer })` is a tile image source
  that strokes the outlines of a `createVectorTileAreaIndex` layer and nothing
  else (state borders beneath a river network). It answers `null` for a tile no
  area reaches. `setLayer` swaps the shapes. Opacity belongs to the layer
  registry, so shared edges do not double-darken.
- `createAreaHoverLabel({ container, ... })` is one DOM element that names the
  area under a desktop pointer: centred on a caller-supplied anchor, or beside
  the pointer when the anchor is off the screen. It takes no pointer events, is
  `aria-hidden`, fades, and is told nothing about what an area is.
- `source.pathPieces({ stretches, view })` reads the decoded tiles already in
  memory and returns the clipped, screen-space pieces of the named stretches,
  ordered along the path (`collectVectorTilePathPieces` is the pure core).
- `createFlowPulseLayer({ canvas, source, style })` draws a dashed pulse that
  runs down a path: one stroke per chain per frame, the geometry read once per
  view or path change, no per-frame allocation, and a loop that runs only while
  a path is set and the map is still (`suspend` and `update`). With
  `prefers-reduced-motion` it holds still and draws downstream chevrons, and it
  follows the preference when it changes.
