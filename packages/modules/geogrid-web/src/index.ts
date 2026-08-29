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
export * from './overlay/index.js'
export * from './tile/index.js'
