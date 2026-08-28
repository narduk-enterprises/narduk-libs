# Changelog

## Unreleased

- Added `MapKitPinScalingController` / `createMapKitPinScalingController()`:
  zoom-adaptive size, dot-versus-symbol mode, and rank culling over the live
  annotations of a `MapKitAnnotationRegistry`, addressed by key. It composes
  with the registry rather than replacing it -- the registry keeps owning which
  annotations exist, and the controller owns what they look like at the current
  zoom.
- Continuous scaling is published as CSS custom properties on one container
  element (`MAPKIT_PIN_SIZE_PROPERTY` / `--mapkit-pin-size`, a `px` length, and
  `MAPKIT_PIN_SCALE_PROPERTY` / `--mapkit-pin-scale`, unitless), so a zoom
  gesture costs two property writes per frame for any number of pins and creates,
  destroys, and rewrites nothing. Structural state is latched per *class* rather
  than per pin, so a frame costs O(classes) and only a class that actually
  crossed a threshold touches its members; the change event names exactly those
  keys, batched into one frame, and never names a culled pin.
- Every threshold is latched with tunable hysteresis (`dotPx` 1.5, `rankZoom`
  0.25, `stepZoom` 0.15), and the three latches are exported as pure functions in
  their own right: `latchedStepIndex()`, `latchedPinMode()`, and
  `cullProbeZoom()`. Culling applies its deadband to the question rather than the
  answer, which keeps it at two rank-floor evaluations per frame.
- Added `createMapKitPinSizeCurve()`, `defaultMapKitPinSizeCurve`,
  `defaultMapKitPinSizeStops` (5px at z5 to 26px at z10), and
  `DEFAULT_MAPKIT_PIN_DOT_BELOW_PX`. A curve is a plain `(zoom) => px` function,
  so consumers can supply their own, and a class may carry its own through
  `sizeCurve`, which publishes a scoped `--mapkit-pin-size-<class>` /
  `--mapkit-pin-scale-<class>` pair. `'linear'` interpolation is the default and
  hits every anchor exactly; `'step'` reproduces the classic ladder.
- Added `defaultMapKitPinRankFloor()` and the `MapKitPinRankFloor` shape: the
  lowest class rank that survives a given zoom, so the least distinctive classes
  drop out first as the camera pulls back.
- Added `mapKitZoomForSpan()`, which derives a web-mercator zoom from the
  documented `region.span.longitudeDelta` and the rendered element width.
  `mapkit.Map` exposes no public `zoomLevel` and no `camera`, and
  `cameraDistance` needs both a latitude correction and MapKit's own
  field-of-view constant, so the span is the only public-API source.
- `beginGesture()` / `endGesture()` follow the camera continuously through the
  injectable frame scheduler. MapKit JS publishes only bracket pairs
  (`region-change-start`/`-end`, `zoom-start`/`-end`, `scroll-start`/`-end`) and
  no continuous camera event, so scaling during a pinch means reading the camera
  once per animation frame between the brackets. There is no polling at rest, and
  a consumer that wires nothing but `region-change-end` degrades to
  end-of-gesture snapping.
- `select()` / `deselect()` / `setSelection()` exempt a pin from culling and from
  dot mode; `shouldPaint` defers repaints for pins outside the viewport and
  `flushDeferred()` releases them after a pan, while culling still applies
  immediately. `visible` is written only when the controller is changing it, and
  `destroy()` restores exactly the pins it culled, removes exactly the properties
  it published, and leaves the registry alone.
- Documented the module, the README `Pin Scaling` section, and
  `examples/pin-scaling.ts`, including what MapKit JS actually provides and the
  MapKit JS 5 caveat that a map carrying a `TileOverlay` snaps to integral zoom
  levels.

## 1.5.0 - 2026-08-28

- Added `createMapKitFullscreenController()` / `MapKitFullscreenController`:
  two-mode fullscreen presentation for a map surface. `'viewport'` -- the
  default everywhere a default exists -- makes the element a fixed overlay
  filling the browser viewport; `'fullscreen'` uses the Fullscreen API and falls
  back to viewport mode when the API is missing (iPhone Safari has no element
  fullscreen) or the request is refused, reporting the fallback in the change
  event rather than failing. Viewport mode saves and restores the element's
  inline `style.cssText`, sets `data-mapkit-fullscreen` as a styling hook, locks
  and restores document scrolling, and exits on Escape; native mode tracks an
  external exit through `fullscreenchange` and runs the same restore path.
  `enter()`, `exit()`, `toggle()`, `destroy()`, `subscribe()`, `active`, `mode`,
  and `supportsNativeFullscreen` make up the surface, and `document` / `window`
  are injectable as in `MapKitClientOptions`. Nothing is presented until a
  consumer constructs the controller and calls it, and no DOM global is touched
  at import time.
- Added the `onLayout` hook, called after every geometry change and before the
  subscribers, so a consumer can settle layout with the existing
  `refreshMapKitMapLayout(map)` before rendering chrome.
- Added `MAPKIT_FULLSCREEN_ATTRIBUTE`, the `data-mapkit-fullscreen` attribute
  name, so consumers can style the presented element without hardcoding it.
- Documented the containing-block caveat in the module, the README, and the Nuxt
  adapter: an ancestor with `transform`, `filter`, `backdrop-filter`,
  `perspective`, or `contain: paint` becomes the containing block for a
  fixed-position element and traps viewport mode inside it. The controller
  deliberately does not reparent the element, because moving a live MapKit
  canvas in the DOM loses map state.
- `AppMapKit` gained an opt-in `fullscreenControl` prop (default `false`) plus
  `fullscreenMode` (default `'viewport'`), a `fullscreen-change` event, and
  `enterFullscreen()` / `exitFullscreen()` / `toggleFullscreen()` / `isFullscreen`
  on its exposed handle. The component presents its own wrapper so the map
  chrome comes along, refreshes MapKit geometry on every change, and destroys
  the controller before unmount.

## 1.4.0 - 2026-08-28

- Added `MapKitAnnotationRegistry`: keyed annotation reconciliation so an
  unchanged marker is never removed, re-added, or mutated. Each descriptor
  carries a `key`, a consumer-defined `signature`, a `create()` factory, and an
  optional in-place `update()` hook; `reconcile()` diffs against the previous
  set, batches every removal into one `removeAnnotations` call and every
  addition into one `addAnnotations` call, and makes no host call at all when
  nothing changed. This replaces the `removeAnnotations(all)` +
  `addAnnotations(next)` pattern that rebuilds and visibly blinks every marker
  on each render.
- Added `createMapKitRenderScheduler()`: coalesces many `mark(region)` calls
  into one flush per animation frame, with `flushNow()`, `cancel()`,
  `destroy()`, injected animation frames, and re-entrant marks deferred to a
  follow-up frame rather than recursing.
- Added `createMapKitHtmlSlotRenderer()`: remembers the last HTML written per
  element in a `WeakMap` and skips byte-identical `innerHTML` writes, plus
  `forget()` and `writeAll()`.
- Added `createMapKitFocusPreserver()`: captures the focused element's stable
  key and selection range before a batch of slot writes and restores it after,
  so a rewrite does not drop the user's caret.
- Added `MapKitFrameScheduler` / `defaultMapKitFrameScheduler` to `timers.js`
  as the shared injectable animation-frame surface. `crossfadeMapKitOverlayOpacity()`
  now uses it instead of its own private copy; behavior is unchanged.
- Bumped `@narduk-geo/narduk-mapkit-nuxt` to the same version with no source
  change; the release workflow requires both workspace packages to carry
  identical versions.

## 1.3.0 - 2026-08-28

- Added `createTemporalLayerController()` / `MapKitTemporalLayerController`,
  which binds the existing temporal playback primitives to one
  `MapKitLayerRegistry` layer: scrub by index or date id, step, readiness-gated
  looping over the last N dates at a configurable interval, bounded prefetch,
  failed-frame skipping, change/readiness/stall/error events, and a
  consumer-set reduced-motion flag that refuses looping and makes every scrub
  instant.
- Added `normalizeTemporalFrames()` and the `TemporalFrame` shape so a dated
  sequence can carry per-date consumer metadata without the core knowing what
  it means.
- Added `attachMapKitPointerProbe()` / `MapKitPointerProbe`: unified pointer
  plumbing for map probing with throttled hover (default 90ms), click-to-pin,
  touch tap-to-pin, long-press-to-pin (default 500ms) with movement and
  duration disambiguation from a pan, pin-drag repositioning, dismissal, and a
  single `{ mode, phase, point, coordinate, pointer, source }` event surface.
  It works against any element that supports `addEventListener` plus an
  injected coordinate-conversion callback, so it stays engine-agnostic and
  testable without MapKit JS.
- Added `MapKitTimerScheduler` so both new primitives accept an injected
  clock and are deterministic under test.
- Documented the previously undocumented temporal playback primitives
  (`nextDrawableFrame`, `temporalProgress`, `boundedFrameCache`,
  `FrameReadiness`, `TemporalPlaybackState`) in the README.
- Bumped `@narduk-geo/narduk-mapkit-nuxt` to the same version with no source
  change; the release workflow requires both workspace packages to carry
  identical versions.

## 1.2.0 - 2026-07-19

- Added `MapKitLayerRegistry.reconcile()` for multi-dataset tile stacks: sync a
  desired layer set in one call with independent opacity, register/unregister
  by id, and replace only when the tile source identity changes.
- Added `layerSourceIdentity()` so consumers can fingerprint urlTemplate /
  bounds / z-range (or async `data`) without comparing opacity.

## 1.1.1 - 2026-07-16

- Made zero-duration layer replacement construct the incoming overlay at its
  final opacity before retiring the previous overlay. This avoids Safari
  MapKit's unreliable repainting after mutable `TileOverlay.opacity` changes.

## 1.1.0 - 2026-07-16

- Added MapKit JS 6 core-library loading and asynchronous
  `Promise<ImageSource>` tile-overlay construction.
- Extended `MapKitLayerRegistry` to own async overlay replacement, first-image
  readiness, bounded fallback activation, error reporting, and stale-overlay
  retirement.

## 1.0.0 - 2026-07-16

- Established this `narduk-geo/narduk-mapkit` repository as the canonical
  two-package workspace.
- Added public `@narduk-geo/narduk-mapkit-nuxt` with `AppMapKit`, `useMapKit`,
  `useMapkitToken`, Nuxt module registration, and a Worker-compatible token
  route that retains the unconfigured `503` contract.
- Added the `@narduk-geo/narduk-mapkit/apple-maps` access-token, search, and
  geocode API.
- Added idempotent vector-overlay helpers from the preserved legacy checkout.
- Added the Earthdata tile-intersection decision cache, bounded at 2,048
  entries and shared across scale variants.
- Pointed package metadata at `github.com/narduk-geo/narduk-mapkit` and added
  public-npm, `publint`, Nuxt production-build, and packed-consumer gates.
- Added `refreshMapKitMapLayout` so consumers can refresh MapKit viewport
  geometry after responsive container or drawer layout changes.
- Split the token runtime into Web-standard `/server` and `/worker` exports and
  an explicit Node-only `/node` export for `process.env` and Doppler CLI lookup.
- Added warning-free Cloudflare module and packed-consumer gates that reject
  Node built-ins and prove GET-only `503`, `403`, `200`, and binding behavior.
- Added an app-owned token rate-limit hook with `429`/`Retry-After` support.
- Removed the mutable local-tarball publish poller and its `latest.tgz` channel.
- Removed Austin-specific fallback coordinates and property fields from the
  generic Nuxt map component.

## 0.3.1

- Fixed a critical bug in `createBoundsGatedUrlTemplate`'s function-form `urlTemplate`:
  real MapKit JS invokes it as `(x, y, z, scale)`, not `(x, y, scale, z)`. The wrong
  order meant every bounds-gated overlay silently computed tile bounds using the
  scale factor as the zoom level (almost always `1`), which gated out every real
  tile request as out-of-bounds -- overlays rendered nothing, with no error.
  Confirmed against the real MapKit JS SDK, not just documentation.

## 0.3.0

- Added a MapKit JS layer registry for multiple live tile overlays with independent opacity.
- Added bounds-gated tile URL templates that short-circuit outside-AOI tile requests to a transparent PNG.
- Added AOI-aware layer region helpers that tighten default minimum spans for small layer bounds.
- Added layer registry documentation and an example showing two simultaneous AOI raster layers.

## 0.2.0

- Added reusable MapKit JS runtime helpers for coordinates, regions, tile overlays, and cancellable overlay opacity crossfades.
- Added shared region helpers for point lists, lng/lat bounds, GeoJSON, and common drawable collections.
- Added bounded server-side caching for origin-scoped signed MapKit JS tokens.
- Coalesced concurrent browser token refreshes during MapKit authorization callbacks.
- Hardened signed-token cache partitioning across Apple private-key rotation.
- Added Hono, Nuxt, browser marker, and animated tile overlay examples.
- Added package export and clean-room tarball install smoke validation to the canonical quality gate.
- Added contributor and security policy docs for production library maintenance.
- Updated CI to run on push and pull requests with a portable Node job.
- Updated package metadata and license for public open-source distribution.

## 0.1.1

- Initial framework-agnostic MapKit JS token, browser initialization, geometry, and playback helpers.
