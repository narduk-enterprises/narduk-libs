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
export const MAPKIT_COMPONENT_CSS = `/* @narduk-enterprises/narduk-mapkit -- host chrome for <AppMapKit>.
 * Single-class selectors, loaded first: your own rules win on order. */
.mapkit-wrapper {
  position: relative;
  overflow: hidden;
  block-size: 100%;
}

.mapkit-canvas {
  block-size: 100%;
  inline-size: 100%;
}

.mapkit-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

/* The status host must not eat map gestures; its own children stay clickable. */
.mapkit-status > * {
  pointer-events: auto;
}

.mapkit-fallback {
  position: absolute;
  inset: 0;
  overflow: auto;
}
`
