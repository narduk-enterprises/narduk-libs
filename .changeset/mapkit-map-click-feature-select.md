---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`<AppMapKit>` now emits `map-click` and `feature-select` (#1729). Both were
declared since 2.1.0 and never fired. `map-click` carries `{ lat, lng }` from
the map's `single-tap` (`convertPointOnPageToCoordinate`). `feature-select`
carries the `geojson` feature whose polygon contains the tap, found by even-odd
hit-testing the coordinate against the prop (holes are empty), so it needs
neither `enabled` overlays nor MapKit overlay selection.

The `./testing` fake now models `PolygonOverlay`, `PolylineOverlay`,
`CircleOverlay` and `Style` (behind the `overlays` library), and
`map.addOverlay` / `addOverlays` / `removeOverlay` / `removeOverlays` /
`overlays`, as state: they appear in `inspect.operations` and `map.overlays`,
and nothing is drawn. A geojson map no longer throws
`FakeMapKitNotImplemented: mapkit.PolygonOverlay` under the fake. The fake map
also answers `convertPointOnPageToCoordinate`, and
`inspect.tapMap(map, location)` fires a `single-tap` so a test can drive both
emits.
