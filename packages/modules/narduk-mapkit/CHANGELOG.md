# Changelog

## 1.0.0 - Unreleased

- Established this `narduk-geo/narduk-mapkit` repository as the canonical
  two-package workspace.
- Added public `@loganrenz/narduk-mapkit-nuxt` with `AppMapKit`, `useMapKit`,
  `useMapkitToken`, Nuxt module registration, and a Worker-compatible token
  route that retains the unconfigured `503` contract.
- Added the `@loganrenz/narduk-mapkit/apple-maps` access-token, search, and
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
