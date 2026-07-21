# Changelog

## 0.1.0 — 2026-07-21

Initial extract from `earthdata-viewer` temporal playback (`temporalRaster`, `temporalWebGL`, `temporalCanvas`).

### Added

- `@narduk-geo/geogrid-web` with `core` / `render` / `overlay` exports
- `decodeTemporalChunk` for `NARDUKTR1` / `earth-data-temporal-raster-v1`
- `createGridOverlay` — WebGL2 primary, Canvas2D fallback
- Shared `normalizeValue` / ramp sampling aligned with GeoGridKit intent
- Coastline stencil on **both** WebGL2 and Canvas2D backends
- Style updates re-upload GPU uniforms; GPU frame cache protects active blend pair
- Skip draw when viewport is unusable (no silent world fallback)

### Known limitations

- Antimeridian / dateline-crossing data bboxes not handled
- Tile baker / float `.bin` grid-tile wire format (GeoGridKit contract 1) not yet ported
- WebGPU not implemented
