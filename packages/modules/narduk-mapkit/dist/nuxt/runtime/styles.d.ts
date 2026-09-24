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
 * the universal selector, or a class and a `:where()` state, neither of which
 * adds anything), and the stylesheet is inserted FIRST -- so an app's own
 * single-class rule for the same property wins on order, with no `!important`.
 *
 * The `.mapkit-*` rules set no colour, font, radius or shadow: they are layout
 * the component cannot work without, not a theme. The one exception is the
 * default error content (`.mk-status-*`, narduk-libs#614): a bare `<button>`
 * would otherwise draw with the browser's own chrome inside a themed map. Those
 * rules read the same `--mk-*` custom properties as `MAPKIT_MARKS_CSS`, with
 * the same neutral fallbacks, so a host themes them from any ancestor.
 */
export declare const MAPKIT_COMPONENT_CSS = "/* @narduk-enterprises/narduk-mapkit -- host chrome for <AppMapKit>.\n * Single-class selectors, loaded first: your own rules win on order. */\n.mapkit-wrapper {\n  position: relative;\n  overflow: hidden;\n  block-size: 100%;\n}\n\n.mapkit-canvas {\n  block-size: 100%;\n  inline-size: 100%;\n}\n\n.mapkit-status {\n  position: absolute;\n  inset: 0;\n  display: grid;\n  place-items: center;\n  pointer-events: none;\n}\n\n/* The status host must not eat map gestures; its own children stay clickable. */\n.mapkit-status > * {\n  pointer-events: auto;\n}\n\n/* The default #error content. A host that fills the slot draws its own. */\n.mk-status-retry {\n  appearance: none;\n  margin: 0;\n  padding: 0.375rem 0.875rem;\n  border: 1px solid var(--mk-ink, #0e1418);\n  border-radius: 6px;\n  background: var(--mk-surface, #ffffff);\n  color: var(--mk-ink, #0e1418);\n  font: inherit;\n  font-family: var(--mk-font-sans, ui-sans-serif, system-ui, sans-serif);\n  cursor: pointer;\n}\n\n.mk-status-retry:where(:focus-visible) {\n  outline: 2px solid var(--mk-focus, #0e1418);\n  outline-offset: 2px;\n}\n\n.mapkit-fallback {\n  position: absolute;\n  inset: 0;\n  overflow: auto;\n}\n\n/* Leader overlay: a line from the selected pin to the card. Pointer-events\n * stay off so the map and the callout keep their own hits. */\n.mapkit-leader {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  overflow: visible;\n  z-index: 8;\n}\n";
//# sourceMappingURL=styles.d.ts.map