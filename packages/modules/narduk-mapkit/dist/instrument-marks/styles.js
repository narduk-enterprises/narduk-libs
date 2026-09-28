/** Styles for the instrument mark renderer. Theme through --mk-* properties. */
export const MAPKIT_INSTRUMENT_MARKS_CSS = `/* Station marks. Each annotation element is a zero-size anchor on the coordinate. */

.mk-mark {
  position: relative;
  /*
   * \`flow-root\` keeps the anchor exactly where the kit put it. Everything the
   * pin hangs beside the dot -- the value tab, the station name, the selected
   * callout's leader -- is positioned from this box, and the hit target's own
   * centring margin is negative, so without a block formatting context here
   * that margin collapses into the anchor and drags all three half a hit
   * target above the dot. Real MapKit reproduces it; the e2e fake's own
   * container does not, so only a deployed preview showed it.
   */
  display: flow-root;
  width: 0;
  height: 0;
  font-family: var(--mk-font-sans, ui-sans-serif, system-ui, sans-serif);
}

.mk-pip,
.mk-void {
  position: absolute;
  box-sizing: border-box;
  border-radius: 50%;
  pointer-events: none;
}

.mk-pip {
  background: #7d8890;
  box-shadow: 0 0 0 1.5px #ffffff;
}

.mk-void {
  border: 1.5px solid var(--mk-void, #5e6870);
  background: rgb(255 255 255 / 0.85);
}

.mk-hit {
  position: absolute;
  left: 0;
  top: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/*
 * WCAG 2.5.8: guarantee a >=24x24 hit box without growing the drawn pin or
 * cluster, which the kit sizes inline and can be as small as 8px for a low
 * station count. The hit-testable area is expanded via an invisible,
 * centred pseudo-element rather than by resizing .mk-hit itself.
 */
.mk-hit::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: max(24px, 100%);
  height: max(24px, 100%);
  transform: translate(-50%, -50%);
}

.mk-hit:focus-visible {
  outline: 2px solid var(--mk-focus, #2563eb);
  outline-offset: 3px;
}

/*
 * A pin: \`.mk-pin\` is the (possibly touch-padded) hit target, sized inline by
 * the kit and centred on the anchor by a negative inline margin; inside it one
 * \`<svg>\` holds the whole drawing. Every colour, width and dash pattern is an
 * attribute the builder sets from its paint, so nothing here names a reading
 * -- these rules only carry what is constant across all of them.
 *
 * The drawing is centred by absolute positioning, not by the hit target's own
 * box: a long windsock makes the \`<svg>\` wider than the 32-44px target, and a
 * grid track that sizes to its item leaves an oversized item sitting at the
 * target's top left, which walked every pin off its station by
 * \`extent - hitSize / 2\`. \`translate\` is its own property so the hover
 * \`transform\` still composes.
 *
 */
.mk-pin {
  position: relative;
  display: block;
  overflow: visible;
  border-radius: 50%;
}

.mk-pin-svg {
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  overflow: visible;
  pointer-events: none;
  transition: transform 0.12s ease;
}

.mk-pin:hover .mk-pin-svg {
  transform: scale(1.06);
}

/* The white halo that lifts an instrument off the basemap. */
.mk-pin-halo {
  fill: none;
  stroke: #ffffff;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* A gust's extension of the windsock, in the reading's own colour. */
.mk-pin-ghost {
  stroke: none;
  opacity: 0.32;
}

/* The hairline a gauge arc sweeps across. */
.mk-pin-track {
  fill: none;
  stroke: rgb(14 20 24 / 0.22);
  stroke-width: 1.5;
}

/* The instrument itself: windsock, crests or gauge arc. */
.mk-pin-body {
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* A reading below its instrument's threshold: calm is not "no sensor". */
.mk-pin-calm {
  fill: none;
  stroke-width: 1.5;
}

/*
 * R2, one way to show a crowd: a mark hiding two or more neighbours draws a
 * second dot of its own size behind it, nudged up-right (offset inline).
 */
.mk-pin-stack {
  stroke: #ffffff;
  stroke-width: 1.5;
}

/* The selection ring: a white band under an ink one (#239). */
.mk-pin-sel-halo {
  fill: none;
  stroke: #ffffff;
  stroke-width: 5;
}

.mk-pin-sel {
  fill: none;
  stroke: var(--mk-ink, #0e1418);
  stroke-width: 2;
}

/* The station's own dot, or the gauge badge that carries a numeral. */
.mk-pin-dot {
  paint-order: stroke;
}

.mk-pin-num {
  font-family: var(--mk-font-mono, ui-monospace, monospace);
  font-weight: 600;
  letter-spacing: -0.02em;
}

/*
 * The close tier's value tab: the reading an instrument carries no numeral
 * for, on whichever side the instrument leaves clear (placed inline).
 */
.mk-tab {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  height: 16px;
  padding: 0 5px;
  transform: translateY(-50%);
  border-radius: 8px;
  background: var(--mk-surface, #ffffff);
  box-shadow:
    0 0 0 1px var(--mk-line, #c9d1d7),
    0 1px 2px rgb(14 20 24 / 0.18);
  font-family: var(--mk-font-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  color: var(--mk-ink, #0e1418);
  white-space: nowrap;
  pointer-events: none;
}

.mk-name {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  height: 22px;
  padding: 0 10px;
  transform: translateY(-50%);
  border-radius: 11px;
  background: var(--mk-ink, #0e1418);
  box-shadow: 0 2px 6px rgb(14 20 24 / 0.3);
  font-size: 13px;
  font-weight: 600;
  line-height: 22px;
  color: #ffffff;
  white-space: nowrap;
  pointer-events: none;
}

/* #181: close-tier station names, centred below their pin. */
.mk-pin-name {
  position: absolute;
  left: 0;
  transform: translateX(-50%);
  font-family: var(--mk-font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 13px;
  color: var(--mk-ink-2, #3c4a54);
  white-space: nowrap;
  pointer-events: none;
  text-shadow:
    0 0 2px #ffffff,
    0 0 3px #ffffff;
}

/* The leader joins the pill to the selection ring (#239). */
.mk-name::before {
  content: '';
  position: absolute;
  top: 50%;
  right: 100%;
  width: var(--mk-leader, 10px);
  height: 2px;
  margin-top: -1px;
  background: var(--mk-ink, #0e1418);
}

.mk-name.is-flip::before {
  right: auto;
  left: 100%;
}`;
//# sourceMappingURL=styles.js.map