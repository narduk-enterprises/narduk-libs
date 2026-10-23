# @narduk-enterprises/narduk-maps

## 0.2.2

### Patch Changes

- d16e0cc: Fix the ponytail-5 map findings: geogrid overview buckets no longer
  drop pixels inside a real cell and the tile renderer rebuilds its GL objects
  after a context restore; candle charts keep a controlled domain when a bar is
  appended, aggregate candles into non-overlapping buckets, scale volume bars to
  the drawn buckets, and the histogram ignores non-finite samples; narduk-maps
  drops `javascript:` and other unsafe point hrefs; narduk-mapkit no longer
  paints a vector tile read that began before `clearCache`, and its Nuxt token
  example derives the claim origin with `mapKitRoutedOrigin`.
- 563ca2d: Fix the ponytail-5 should-fix findings for charts, maps and geogrid.
  narduk-charts: a NaN sample no longer poisons every later moving average or
  Bollinger band, line `pointClick` reports the original index under
  `maxRenderPoints`, a log axis gaps zero and negative values, and scatter
  points share one roving tab stop with arrow-key navigation. narduk-maps: a
  non-finite point or empty geometry no longer blanks the frame, bounds that
  cross longitude 180 frame correctly, mark sprites are keyed by size,
  interactive maps keep their shape buttons in the tab order after GL is ready,
  `plain` stays the SVG poster, and a WebGL error keeps the poster up.
  geogrid-web: the Canvas2D backend clears on a rejected frame, `renderAt`
  re-aims the stretch at the bbox it paints, and temporal headers must be valid
  UTF-8 and carry a non-inverted bbox (manifest and coastline stencil).

## 0.2.1

### Patch Changes

- c98751d: Use `dvh` instead of `vh`/`h-screen` for viewport heights (auth
  pages, admin users tab, brand backdrop) so mobile browser chrome no longer
  hides the bottom of the page.

## 0.2.0

### Minor Changes

- c012b64: Add `@narduk-enterprises/narduk-maps` 0.1.0: one map picture drawn by
  two engines. `NardukGeoMap` is an SSR-identical SVG map (choropleth fills,
  hatch for no data, shoreline halo, the five mark shapes, collision-free
  labels, an optional baked cutout basemap). `NardukMap` mounts MapLibre over
  the same picture, as symbol-layer marks that let place names step aside, and
  fades in on idle. `createBasemapStyle` is the OpenFreeMap style as pure data.
  `.` and `./svg` never import `maplibre-gl`, which is an optional peer used
  only by `./gl`. create-narduk-app gains a `maps` capability that pins the
  package the same way `charts` does.
