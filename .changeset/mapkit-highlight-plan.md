---
'@narduk-enterprises/narduk-mapkit': minor
---

A vector tile overlay can light many stretches in many styles at once.

- `source.setHighlightPlan({ strokes })` takes a plan: `strokes(si, streamOrder,
  zoom)` answers one stroke, several (a faint wide halo under the line), or
  `null` for each piece of each cached tile, and the highlight overlay draws what
  it is given, batched by style and ordered by `layer` then stream order. A
  stretch can keep the colour the network gives it and only gain width, which a
  single flat highlight style could not do. `source.highlightPlan` reads it back.
  `setHighlight` and `setHighlightPlan` replace each other, `clearHighlight`
  clears either, and the highlight overlay is still the only thing swapped.
- `paintVectorTileHighlightPlan` and the `VectorTileHighlightPlan` and
  `VectorTileHighlightStroke` types are exported. Strokes under one device pixel
  draw as one device pixel at proportionally lower opacity, like the network.
  `setHighlight` is unchanged.
