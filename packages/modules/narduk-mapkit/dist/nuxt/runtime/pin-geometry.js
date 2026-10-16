/**
 * Per-pin anchor geometry (narduk-libs#305, spec §c.3; corrected in narduk-libs#1908).
 *
 * ## The defect this replaces
 *
 * 2.0.x gave every annotation one global `annotationSize` (default 100x56) and
 * a hard-coded `anchorOffset` of `(0, -6)`. A consumer whose pin is not 100x56
 * -- Buoys' 170x150 station card, for instance -- got a marker displaced by the
 * difference. There was no way to fix it from the app, because the app cannot
 * know what MapKit will do with the offset.
 *
 * ## What MapKit's `anchorOffset` actually means
 *
 * 2.1.0 modelled it as "the element's top-left lands on `projected + offset`".
 * That is not what MapKit JS does, and the fake at `./testing` repeated the
 * same mistake, so every test agreed with it. Measured on the live library
 * (`mapkit.convertCoordinateToPointOnPage` against the element's bounding box,
 * MapKit JS 6.0.128 and 6.1.182, identical on both):
 *
 * 1. With `anchorOffset (0, 0)` the element is centred horizontally on the
 *    coordinate with its **bottom edge** on it.
 * 2. A non-zero offset then moves the element by the **negative** of the
 *    offset: `(10, 0)` moves it 10 px left, `(0, -10)` moves it 10 px down.
 *
 * So the point of the element that sits on the coordinate is
 * `(width / 2 + offset.x, height + offset.y)`, in CSS px from its top-left.
 * `<AppMapKit>` therefore asks the question an app can answer -- *which point
 * of my pin sits on the coordinate?* -- and solves for MapKit's offset:
 *
 * ```text
 * mapKitOffset = anchorPoint - (width / 2, height) - appOffset
 * ```
 *
 * A 170x150 pin anchored `bottom-center` gets `(0, 0)`, MapKit's own default;
 * anchored `center` it gets `(0, -75)`; a 16x16 `center` dot gets `(0, -8)`.
 * `tests/testing/fake-mapkit.test.ts` pins the fake to the measured behaviour,
 * so these numbers are checked against a projection that places elements the
 * way MapKit does.
 */
export const DEFAULT_MAPKIT_PIN_ANCHOR = 'bottom-center';
/** The element-local point that lands on the coordinate, in CSS px from its top-left. */
export function mapKitAnchorPoint(anchor, size) {
    if (typeof anchor === 'object')
        return { x: anchor.x, y: anchor.y };
    if (anchor === 'top-left')
        return { x: 0, y: 0 };
    if (anchor === 'top-center')
        return { x: size.width / 2, y: 0 };
    if (anchor === 'center')
        return { x: size.width / 2, y: size.height / 2 };
    return { x: size.width / 2, y: size.height };
}
/**
 * MapKit's own `anchorOffset` for one pin.
 *
 * MapKit puts the point `(width / 2 + offset.x, height + offset.y)` of the
 * element on the coordinate (see the file comment), so the offset that puts
 * `anchorPoint - appOffset` there is `anchorPoint - (width / 2, height) -
 * appOffset`. `bottom-center` with no app offset is `(0, 0)`.
 *
 * With no `size` there is nothing to anchor against, so only the app's explicit
 * `anchorOffset` survives -- never the 2.0.x `(0, -6)`, which is the defect.
 */
export function mapKitAnchorOffset(geometry) {
    const offset = geometry.anchorOffset ?? { x: 0, y: 0 };
    const size = geometry.size;
    if (!size)
        return { x: offset.x, y: offset.y };
    const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size);
    return { x: anchor.x - size.width / 2 - offset.x, y: anchor.y - size.height - offset.y };
}
/**
 * Where the pin's top-centre is, relative to the coordinate, in CSS px: the
 * point a callout should point at. `(0, -height)` for a `bottom-center` pin,
 * `(0, -height / 2)` for a `center` one, wherever the anchor and offset put it.
 *
 * Without a `size` the pin's height is unknown here, so this answers `(0, 0)`
 * plus the app's own offset in MapKit's convention -- the same as 2.1.x.
 */
export function mapKitCalloutAnchorOffset(geometry) {
    const offset = geometry.anchorOffset ?? { x: 0, y: 0 };
    const size = geometry.size;
    if (!size)
        return { x: offset.x, y: offset.y };
    const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size);
    return { x: size.width / 2 - anchor.x + offset.x, y: -anchor.y + offset.y };
}
/**
 * Offset from the element's top-left corner to the coordinate it is anchored
 * on, in CSS px. The inverse of the placement, for a caller that can read the
 * element's position (its `offsetLeft` / `offsetTop`) but cannot project.
 * `measured` stands in for a geometry with no `size`.
 */
export function mapKitCoordinateWithinPin(geometry, measured = { height: 0, width: 0 }) {
    const offset = geometry.anchorOffset ?? { x: 0, y: 0 };
    const size = geometry.size;
    if (!size)
        return { x: measured.width / 2 + offset.x, y: measured.height + offset.y };
    const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size);
    return { x: anchor.x - offset.x, y: anchor.y - offset.y };
}
/** Stable string for a geometry, so an unchanged one never repaints a pin. */
export function mapKitPinGeometrySignature(geometry) {
    const offset = geometry.anchorOffset ?? { x: 0, y: 0 };
    const size = geometry.size;
    const anchor = geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR;
    return [
        typeof anchor === 'object' ? `${String(anchor.x)}:${String(anchor.y)}` : anchor,
        size ? `${String(size.width)}x${String(size.height)}` : '-',
        `${String(offset.x)},${String(offset.y)}`,
    ].join('|');
}
/**
 * WCAG 2.5.8 (target size, minimum) asks for 24 CSS px; the platform guidance
 * (Apple HIG, Material) and WCAG 2.5.5 (enhanced) ask for 44. A map dot is
 * usually 8 to 16 px, so the touch target must be bigger than the glyph.
 */
export const MAPKIT_MIN_HIT_TARGET = 44;
const NO_PADDING = { bottom: 0, left: 0, right: 0, top: 0 };
/**
 * Grow a pin's host to at least `minTarget` x `minTarget` CSS px while its
 * visual glyph stays exactly where it was.
 *
 * The host is the interactive element (`role="button"`, the click target), so
 * enlarging it enlarges the tap target without touching the glyph. The visual
 * is centred horizontally. Vertically it keeps the edge its anchor names, so a
 * `bottom-center` pin keeps its tip on the coordinate and grows its hit area
 * upward, a `top-center`/`top-left` pin grows downward, and a `center` pin grows
 * both ways. The returned geometry moves the anchor by the padding, so the
 * coordinate stays on the same point of the glyph.
 *
 * A geometry with no `size` cannot be enlarged (its box is unknown) and is
 * returned as is, with no padding.
 */
export function expandMapKitHitArea(geometry, minTarget = MAPKIT_MIN_HIT_TARGET) {
    const size = geometry.size;
    if (!size || minTarget <= 0)
        return { geometry, padding: NO_PADDING };
    const width = Math.max(size.width, minTarget);
    const height = Math.max(size.height, minTarget);
    if (width === size.width && height === size.height)
        return { geometry, padding: NO_PADDING };
    const anchor = geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR;
    const extraX = (width - size.width) / 2;
    const extraY = height - size.height;
    const verticalShare = anchor === 'bottom-center' ? 1 : anchor === 'top-center' || anchor === 'top-left' ? 0 : 0.5;
    const padding = {
        bottom: extraY * (1 - verticalShare),
        left: extraX,
        right: extraX,
        top: extraY * verticalShare,
    };
    const visualAnchor = mapKitAnchorPoint(anchor, size);
    const enlarged = {
        ...geometry,
        anchor: typeof anchor === 'string' && anchor !== 'top-left'
            ? anchor
            : { x: visualAnchor.x + padding.left, y: visualAnchor.y + padding.top },
        size: { height, width },
    };
    return { geometry: enlarged, padding };
}
//# sourceMappingURL=pin-geometry.js.map