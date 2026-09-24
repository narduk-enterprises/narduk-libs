/**
 * Pure camera geometry that places a coordinate beside a DOM rect.
 *
 * Lives next to `refreshMapKitMapLayout` so a consumer that draws its own pins
 * on `./client` (buoys) and `<AppMapKit>` can both call it. Nothing here
 * touches MapKit JS: the arguments are a visible map rect in Web Mercator
 * units, a frame in CSS pixels, the coordinate's current frame point, and the
 * card (or notch) as a frame-local rect (narduk-libs#517).
 */
/** Visible map rect in MapKit's normalized Web Mercator units (0..1). */
export interface MapKitMapRectLike {
    origin: {
        x: number;
        y: number;
    };
    size: {
        height: number;
        width: number;
    };
}
/** The map element's laid-out box, in CSS pixels. */
export interface MapKitFrameSize {
    height: number;
    width: number;
}
/** A point in the map frame's CSS pixels. */
export interface MapKitFramePoint {
    x: number;
    y: number;
}
/**
 * The card, notch or caret the coordinate should sit beside, in the same
 * frame-local CSS pixels as `point`. A viewport `DOMRect` is only valid after
 * subtracting the map frame's origin.
 */
export interface MapKitAnchorRect {
    height: number;
    width: number;
    x: number;
    y: number;
}
export interface MapKitRectBesideOptions {
    /**
     * True when the station is inside a cluster. Applies one extra zoom step
     * around the coordinate so the cluster breaks before the pan.
     */
    clustered?: boolean;
    /** Zoom factor used when `clustered` is true. Default 2 (one MapKit step). */
    clusterZoom?: number;
    /** Horizontal gap, in CSS pixels, between the anchor and the coordinate. */
    gap?: number;
    /**
     * Frame-pixel Y the coordinate should land on. Omitted, the anchor's
     * vertical centre.
     */
    verticalTarget?: number;
}
/**
 * The frame point that sits `gap` pixels beside `anchor`, on the side with
 * more remaining room, at `verticalTarget` (or the anchor's vertical centre).
 */
export declare function pointBesideAnchor(frame: MapKitFrameSize, anchor: MapKitAnchorRect, options?: Pick<MapKitRectBesideOptions, 'gap' | 'verticalTarget'>): MapKitFramePoint;
/**
 * The visible map rect that places `point`'s coordinate beside `anchor`.
 *
 * `point` is the coordinate's current position in the *input* `rect`. The
 * returned rect keeps the current zoom unless `clustered` is set, in which
 * case it zooms by `clusterZoom` (default 2) around that coordinate and then
 * pans.
 *
 * Returns a copy of `rect` when the frame or the rect has no positive extent,
 * so a caller can hand the result to `setVisibleMapRectAnimated` without a
 * null check.
 */
export declare function rectBeside(rect: MapKitMapRectLike, frame: MapKitFrameSize, point: MapKitFramePoint, anchor: MapKitAnchorRect, options?: MapKitRectBesideOptions): MapKitMapRectLike;
//# sourceMappingURL=rect-beside.d.ts.map