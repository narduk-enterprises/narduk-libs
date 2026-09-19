---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-mapkit/nuxt` auto-imports `useMapKitView()` and `useMapKitFullscreen()`,
lifted from buoys. `useMapKitView()` owns the map behind a map-first page's
`<AppMapKit>` -- camera, frame, zoom tier, padding, basemap, the `./marks` layer
and fullscreen -- and takes the scoped runtime from `map-ready` (K-10). A
map-first app no longer copies buoys' `utils/mapkit/*` and view composables to
draw marks. The `./testing` fake map now models `showsMapTypeControl`.
