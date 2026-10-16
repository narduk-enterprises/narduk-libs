---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

`narduk-mapkit`: moving markers, measured zoom tiers, viewport-bounded annotations and a polite poller.

From `./client`:

- `MapKitMovingMarkerLayer` (and `createMapKitMovingMarkerLayer`) keeps one annotation per id and glides each to its new fix with one `requestAnimationFrame` loop, optionally along its route line (`lines`). A first fix, a hidden tab, `prefers-reduced-motion` and a jump longer than `maxGlideMetres` snap instead of gliding; returning to a hidden tab finishes every glide. The heading is unwrapped so it turns the short way and ignores GPS noise. `setTier` writes `data-mapkit-tier`, `follow(id)` keeps the camera on one marker until the user moves the map, and `hitArea` / `label` / `onSelect` give a 44 px focusable target.
- `MapKitViewportAnnotations` keeps only the items near the visible region in the DOM, with enter/keep hysteresis and a `pinned` set.
- `createMapKitPoller` polls only while the tab is visible, never overlaps requests, asks at once on return and drops stale answers; `mapKitMapLimit` caps concurrent async work.
- `writeMapKitHitArea`, the writer `<AppMapKit>`'s pin layer already used, is now shared and exported.

From `./geometry`:

- Motion: `bearingDegrees`, `shortestAngleDelta`, `unwrapHeading`, `normalizeHeading`, `interpolateLatLng`, `mapKitSnapReason`, `buildGlidePath`, `pathAlongPolylines`, `pointAlongPath`, `pathEndHeading`.
- Declutter: `chooseMapKitMarkerTier` (dot, symbol or detail from measured on-screen overlap, with hysteresis and same-spot tolerance), `chooseMapKitSpanTier`, `collapseNearbyPoints`, `anyCloserThanPixels`, `minSeparationPixels`, `metersPerPixel`, `isInVisibleRegion`, `pointsInVisibleRegion`.

All additions; nothing existing changes behaviour.
