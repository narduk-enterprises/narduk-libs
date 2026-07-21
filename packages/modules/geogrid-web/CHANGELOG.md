# Changelog

## 0.1.1 — 2026-07-21

Production-hardening pass after multi-agent review.

### Fixed

- WebGL plane/mask uploads set `UNPACK_ALIGNMENT=1` so odd widths and non-multiple-of-4 R8 rows no longer skew textures
- Scalar temporal blend mixes in **encoded** space on WebGL (matches Canvas2D and log-scale wire quantization)
- Canvas2D coastline stencil zeros alpha outside the stencil geo bbox (matches WebGL)
- Failed/skipped WebGL `render` clears a previously drawn frame instead of leaving stale pixels
- GPU/CPU caches key by frame content fingerprint, not date alone
- Scalar `dtype: 'uint8'` rejected at decode (unsupported combination)
- Decode fails closed on oversized headers, dimensions, frame counts, and decompressed payloads
- `GridOverlay.destroy()` drops `lastRender` so frame buffers are not retained

### Known remaining limitations

- Dateline-crossing bboxes unsupported
- No tiled `renderTile` baker / float `.bin` grid-tile wire format (GeoGridKit contract 1)
- WebGPU not implemented
- No `webglcontextlost` recovery (host must recreate the overlay)
- Color stops use **display units** (earthdata chart compatibility), not GeoGridKit normalized 0…1 locations
- RGB WebGL still uses hardware LINEAR on value planes (mask-aware neighborhood sampling is scalar-only)

## 0.1.0 — 2026-07-21

Initial extract from `earthdata-viewer` temporal playback (`temporalRaster`, `temporalWebGL`, `temporalCanvas`).

### Added

- `@narduk-geo/geogrid-web` with `core` / `render` / `overlay` exports
- `decodeTemporalChunk` for `NARDUKTR1` / `earth-data-temporal-raster-v1`
- `createGridOverlay` — WebGL2 primary, Canvas2D fallback
- Shared `normalizeValue` / ramp sampling aligned with GeoGridKit intent
- Coastline stencil on both WebGL2 and Canvas2D backends
