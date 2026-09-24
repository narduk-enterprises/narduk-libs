/**
 * The stylesheet for the DOM marks `createPinMark`, `createSelectedMark` and
 * `createBackgroundMark` build, as a TypeScript string for the same reason as
 * `MAPKIT_COMPONENT_CSS`: `tsc` emits no `.css`.
 *
 * Marks are MapKit annotations, so the rules are global rather than scoped to
 * a component. Every colour and font reads a `--mk-*` custom property with a
 * neutral fallback, so a host themes the marks by setting those properties on
 * any ancestor of the map and needs no wrapper class. Lifted from buoys
 * `assets/css/mapkit.css` (narduk-libs#517).
 */
export const MAPKIT_MARKS_CSS = `/* @narduk-enterprises/narduk-mapkit -- map marks. Theme with --mk-* custom properties. */
.mk-mark {
  position: relative;
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
  outline: 2px solid var(--mk-focus, #0e1418);
  outline-offset: 3px;
}

/*
 * A dynamic pin: '.mk-pin' is the (possibly touch-padded) hit target, sized
 * inline by the kit; '.mk-pin-disc' is the visible circle, also sized inline
 * (radius is the reading). Both are centred on the anchor by a negative
 * inline margin, so no CSS transform is needed here.
 */
.mk-pin {
  display: grid;
  place-items: center;
  border-radius: 50%;
}

.mk-pin-disc {
  grid-area: 1 / 1;
  position: relative;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  overflow: visible;
  border-radius: 50%;
  box-shadow:
    0 0 0 1.5px #ffffff,
    0 1px 3px rgb(14 20 24 / 0.28);
  transition: transform 0.12s ease;
}

.mk-pin:hover .mk-pin-disc {
  transform: scale(1.08);
}

.mk-pin.is-sel .mk-pin-disc {
  box-shadow:
    0 0 0 3px #ffffff,
    0 0 0 5px var(--mk-ink, #0e1418),
    0 2px 6px rgb(14 20 24 / 0.3);
}

.mk-pin-text {
  position: relative;
  font-family: var(--mk-font-mono, ui-monospace, monospace);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  pointer-events: none;
}

.mk-pin-glyph {
  position: absolute;
  top: 50%;
  left: 50%;
  overflow: visible;
  pointer-events: none;
}

.mk-glyph-edge {
  fill: none;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.mk-glyph-halo {
  fill: none;
  stroke: #ffffff;
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mk-glyph-ink {
  fill: none;
  stroke: var(--mk-ink, #0e1418);
  stroke-width: 1.6;
  stroke-linecap: round;
}

.mk-glyph-fill {
  fill: var(--mk-ink, #0e1418);
}

/*
 * R2, one way to show a crowd: a pin hiding two or more neighbours draws a
 * second rim of its own size behind it, nudged up-right (offset inline).
 */
.mk-stack {
  grid-area: 1 / 1;
  box-sizing: border-box;
  border-radius: 50%;
  opacity: 0.55;
  box-shadow: 0 0 0 1.5px #ffffff;
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
}

/* MapkitScaleStrip's value-lens key (#232). */
.mk-key {
  font-weight: 500;
  color: var(--mk-ink-3, #55636e);
}
/* The two freshness marks a value lens draws besides its ramp: an older
   reading's hollow disc with a dashed ring, and a silent station's hollow dot. */
.mk-key-mark {
  box-sizing: border-box;
  flex: none;
  border-radius: 50%;
  background: var(--mk-surface, #ffffff);
}
.mk-key-mark--stale {
  width: 12px;
  height: 12px;
  border: 2px dashed var(--mk-ink-3, #55636e);
}
.mk-key-mark--void {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--mk-void, #5e6870);
}
@media (prefers-reduced-motion: reduce) {
  .mk-pin-disc {
    transition: none;
  }
}
`;
//# sourceMappingURL=styles.js.map