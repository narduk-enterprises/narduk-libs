/**
 * The two framework-free composables, as an explicit import for callers
 * outside Nuxt's auto-import.
 *
 * `./nuxt` registers `useMapKitView` and `useMapKitFullscreen` with
 * `addImports`, so an app using the module writes them bare and needs nothing
 * from here. Code auto-import never reaches does: a unit test under plain
 * vitest, an app running with `imports.autoImport` off, or any module that
 * wants the function rather than the ambient name. Until this subpath existed
 * those callers had no door at all -- `./nuxt` exports the option and result
 * TYPES but not the functions they describe, and the exports map has no
 * pattern entry, so the built files were unreachable by design.
 *
 * `useMapKit()` is deliberately NOT here. It reads the module's runtime
 * options through `#imports`, a specifier that only resolves inside a Nuxt
 * build, so a subpath carrying it would throw on import anywhere else. These
 * two need only Vue: the view takes its MapKit namespace from the `map-ready`
 * payload (KIT DEFECT K-10) rather than from the kit handle.
 *
 * `./nuxt` itself stays the module entry and is not widened: importing it is
 * how Nuxt loads the module, and it must not drag Vue's runtime into that
 * graph.
 */
export { useMapKitFullscreen } from './useMapKitFullscreen.js';
export { useMapKitView } from './useMapKitView.js';
export type { UseMapKitFullscreenOptions, UseMapKitFullscreenResult, } from './useMapKitFullscreen.js';
export type { UseMapKitViewOptions, UseMapKitViewResult } from './useMapKitView.js';
//# sourceMappingURL=index.d.ts.map