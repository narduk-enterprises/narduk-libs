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
/** A named point of the pin element, or an explicit one in CSS px from its top-left. */
export type MapKitPinAnchor = 'bottom-center' | 'center' | 'top-center' | 'top-left' | {
    x: number;
    y: number;
};
export interface MapKitPinGeometry {
    /**
     * CSS px the pin is moved AFTER the anchor is applied (`+x` right, `+y`
     * down), so `{ x: 0, y: -4 }` lifts it 4 px. Default `{ x: 0, y: 0 }`.
     *
     * With no `size` there is nothing to solve against and this is handed to
     * MapKit untouched, in MapKit's own convention (the element moves by the
     * NEGATIVE of it).
     */
    anchorOffset?: {
        x: number;
        y: number;
    };
    /**
     * Which point of the element sits on the coordinate. Default `'bottom-center'`.
     * A `{ x, y }` is a point in CSS px from the element's top-left, for a pin
     * whose tip is not one of the four named points (a pill whose dot, not its
     * middle, marks the place).
     */
    anchor?: MapKitPinAnchor;
    /**
     * Element box in CSS px. Omitted means "MapKit measures the rendered glyph",
     * which is correct for a glyph whose size MapKit can read but gives MapKit no
     * anchor to compute -- so an omitted size keeps MapKit's own default
     * (bottom-centre on the coordinate) and the offset at the app-supplied value
     * alone.
     */
    size?: {
        height: number;
        width: number;
    };
}
export declare const DEFAULT_MAPKIT_PIN_ANCHOR: MapKitPinAnchor;
export interface MapKitPoint2D {
    x: number;
    y: number;
}
/** The element-local point that lands on the coordinate, in CSS px from its top-left. */
export declare function mapKitAnchorPoint(anchor: MapKitPinAnchor, size: {
    height: number;
    width: number;
}): MapKitPoint2D;
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
export declare function mapKitAnchorOffset(geometry: MapKitPinGeometry): MapKitPoint2D;
/**
 * Where the pin's top-centre is, relative to the coordinate, in CSS px: the
 * point a callout should point at. `(0, -height)` for a `bottom-center` pin,
 * `(0, -height / 2)` for a `center` one, wherever the anchor and offset put it.
 *
 * Without a `size` the pin's height is unknown here, so this answers `(0, 0)`
 * plus the app's own offset in MapKit's convention -- the same as 2.1.x.
 */
export declare function mapKitCalloutAnchorOffset(geometry: MapKitPinGeometry): MapKitPoint2D;
/**
 * Offset from the element's top-left corner to the coordinate it is anchored
 * on, in CSS px. The inverse of the placement, for a caller that can read the
 * element's position (its `offsetLeft` / `offsetTop`) but cannot project.
 * `measured` stands in for a geometry with no `size`.
 */
export declare function mapKitCoordinateWithinPin(geometry: MapKitPinGeometry, measured?: {
    height: number;
    width: number;
}): MapKitPoint2D;
/** Stable string for a geometry, so an unchanged one never repaints a pin. */
export declare function mapKitPinGeometrySignature(geometry: MapKitPinGeometry): string;
//# sourceMappingURL=pin-geometry.d.ts.map