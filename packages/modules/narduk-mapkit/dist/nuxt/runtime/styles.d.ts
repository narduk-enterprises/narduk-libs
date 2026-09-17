/**
 * The host chrome `<AppMapKit>` needs, as a TypeScript string (2.1.1, K-6).
 *
 * Why a string and not a `.css` file: this package is built by plain `tsc`, and
 * `tsc` copies nothing it cannot compile -- a `.css` beside the runtime would
 * simply not be in `dist/`, so the module could not resolve it at build time in
 * a consuming app. The module writes this out through `addTemplate` instead and
 * puts the result first in `nuxt.options.css`.
 *
 * 2.1.0 shipped no CSS at all, so a consumer that never sized `.mapkit-canvas`
 * got a zero-height map and no clue why; every adopting app wrote the same four
 * rules by hand.
 *
 * SPECIFICITY IS THE CONTRACT. Every selector here is ONE class (or a class and
 * the universal selector, which adds nothing), and the stylesheet is inserted
 * FIRST -- so an app's own single-class rule for the same property wins on
 * order, with no `!important` and no `:where()` gymnastics needed. The rules
 * deliberately set no colour, font, radius or shadow: they are layout the
 * component cannot work without, not a theme.
 */
export declare const MAPKIT_COMPONENT_CSS = "/* @narduk-enterprises/narduk-mapkit -- host chrome for <AppMapKit>.\n * Single-class selectors, loaded first: your own rules win on order. */\n.mapkit-wrapper {\n  position: relative;\n  overflow: hidden;\n  block-size: 100%;\n}\n\n.mapkit-canvas {\n  block-size: 100%;\n  inline-size: 100%;\n}\n\n.mapkit-status {\n  position: absolute;\n  inset: 0;\n  display: grid;\n  place-items: center;\n  pointer-events: none;\n}\n\n/* The status host must not eat map gestures; its own children stay clickable. */\n.mapkit-status > * {\n  pointer-events: auto;\n}\n\n.mapkit-fallback {\n  position: absolute;\n  inset: 0;\n  overflow: auto;\n}\n";
//# sourceMappingURL=styles.d.ts.map