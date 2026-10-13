# @narduk-enterprises/narduk-maps

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
