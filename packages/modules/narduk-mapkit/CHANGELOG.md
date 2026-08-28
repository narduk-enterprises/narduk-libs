# Changelog

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
