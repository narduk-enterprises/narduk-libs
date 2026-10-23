---
'@narduk-enterprises/geogrid-web': patch
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/narduk-maps': patch
---

Fix the ponytail-5 should-fix findings for charts, maps and geogrid. narduk-charts: a NaN sample no longer poisons every later moving average or Bollinger band, line `pointClick` reports the original index under `maxRenderPoints`, a log axis gaps zero and negative values, and scatter points share one roving tab stop with arrow-key navigation. narduk-maps: a non-finite point or empty geometry no longer blanks the frame, bounds that cross longitude 180 frame correctly, mark sprites are keyed by size, interactive maps keep their shape buttons in the tab order after GL is ready, `plain` stays the SVG poster, and a WebGL error keeps the poster up. geogrid-web: the Canvas2D backend clears on a rejected frame, `renderAt` re-aims the stretch at the bbox it paints, and temporal headers must be valid UTF-8 and carry a non-inverted bbox (manifest and coastline stencil).
