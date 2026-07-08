# Changelog

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
