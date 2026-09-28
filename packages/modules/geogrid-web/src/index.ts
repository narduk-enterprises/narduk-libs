/**
 * @narduk-enterprises/geogrid-web — Web twin of GeoGridKit.
 *
 * Two render paths over the same math: a full-screen sibling-canvas overlay
 * (WebGL2 + Canvas2D fallback) for a map this package positions itself, and a
 * Web-Mercator tile baker for a host that owns tiling. WebGPU and vector styles
 * are intentional future work.
 */
export * from './core/index.js'
export * from './render/index.js'
/**
 * The overlay's own names only. `./overlay/index.js` also re-exports seven
 * stretch types from `./core/stretch.js` so a `/overlay`-only consumer can type
 * its listener and `setStretch` argument; the core barrel above already puts
 * those on this entry, so `export *` of the overlay barrel would export each of
 * them twice. `tests/package-entry-exports.test.ts` fails if a name the overlay
 * barrel exports is missing here.
 */
export {
  createGridOverlay,
  type GridOverlay,
  type GridOverlayOptions,
  type GridOverlayStyleInput,
  type SetScalarFrameOptions,
  loadCoastlineStencil,
  type LoadedCoastlineStencil,
} from './overlay/index.js'
export * from './tile/index.js'
