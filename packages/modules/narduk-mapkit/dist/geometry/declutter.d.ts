import type { LatLng } from './helpers.js';
/** The visible region as `<AppMapKit>`'s `region-change` event reports it. */
export interface MapKitVisibleRegion {
    centerLat: number;
    centerLng: number;
    latDelta: number;
    lngDelta: number;
}
/** Metres one screen pixel covers, from the visible latitude span and the map's pixel height. */
export declare function metersPerPixel(latSpanDegrees: number, mapHeightPx: number): number;
/**
 * Whether a point is inside the visible region, plus `padding` of the region's
 * size on every side (default 0.05, so a marker just off the edge still counts).
 * Longitude wraps, so a region across the antimeridian works.
 */
export declare function isInVisibleRegion(point: LatLng, region: MapKitVisibleRegion, padding?: number): boolean;
/** The points inside the visible region (see `isInVisibleRegion`); the others cannot overlap anything you can see. */
export declare function pointsInVisibleRegion<T extends LatLng>(points: readonly T[], region: MapKitVisibleRegion, padding?: number): T[];
/**
 * Two markers this close are at one spot (a layover at the same stop, or one
 * vehicle reported twice). They overlap at every zoom, so they must not hold
 * every other marker in its compact form for good.
 */
export declare const MAPKIT_SAME_SPOT_METRES = 15;
export interface MapKitSeparationOptions {
    /** Pairs closer than this are one spot and are ignored. Default `MAPKIT_SAME_SPOT_METRES`. */
    sameSpotMetres?: number;
}
/**
 * The smallest on-screen gap between any two points, in pixels; `Infinity` with
 * fewer than two. Compares every pair, so it is for tens of points. For
 * thousands use `anyCloserThanPixels`.
 */
export declare function minSeparationPixels(points: readonly LatLng[], latSpanDegrees: number, mapHeightPx: number, options?: MapKitSeparationOptions): number;
/**
 * Whether any two points (not at one spot) are closer than `thresholdPx` on
 * screen. Hashes into a grid one threshold wide, so it is linear in the number
 * of points where `minSeparationPixels` is quadratic.
 */
export declare function anyCloserThanPixels(points: readonly LatLng[], thresholdPx: number, latSpanDegrees: number, mapHeightPx: number, options?: MapKitSeparationOptions): boolean;
/** `dot`: compact, for crowds. `symbol`: the normal marker. `detail`: close in, drawn with detail such as a heading. */
export type MapKitMarkerTier = 'detail' | 'dot' | 'symbol';
export interface MapKitMarkerTierInput {
    /** Latitude span (degrees) at or below which the `detail` tier is chosen; omit for never. */
    detailBelowSpan?: number;
    /** Leaving the dot tier needs this much more room than entering it. Default 1.2. */
    hysteresis?: number;
    /** Pixel height of the map. */
    mapHeightPx: number;
    /** On-screen width of the `symbol` tier, in CSS px: closer than this and markers would overlap. */
    markerPx: number;
    /** The markers' positions. Only those in `region` (when given) count. */
    points: readonly LatLng[];
    /** The tier now drawn, for hysteresis. */
    previous?: MapKitMarkerTier;
    /** The visible region, when known. */
    region?: MapKitVisibleRegion | null;
    sameSpotMetres?: number;
    /** Latitude span in view, degrees; `null` before MapKit has reported a region. */
    span: number | null;
    /** The tier to use before the span is known. Default `'symbol'`; a map of several routes might say `'dot'`. */
    unknownSpanTier?: 'dot' | 'symbol';
    /** Padding of the visible-region filter, as a fraction of the region. Default 0.05. */
    viewPadding?: number;
}
/**
 * The tier to draw a set of markers in.
 *
 * 1. Before the span is known: `unknownSpanTier`.
 * 2. Any two markers (in view, not at one spot) closer than `markerPx` on
 *    screen: `'dot'`. Staying in `'dot'` needs `markerPx * hysteresis` of room
 *    to leave, so a pinch around the threshold does not flicker.
 * 3. Otherwise `'detail'` when the span is at or below `detailBelowSpan`, else
 *    `'symbol'`.
 */
export declare function chooseMapKitMarkerTier(input: MapKitMarkerTierInput): MapKitMarkerTier;
/** A tier that applies while the latitude span is at or below `maxSpan`. */
export interface MapKitSpanTier<TTier extends string> {
    maxSpan: number;
    tier: TTier;
}
/**
 * A named tier from the latitude span alone, for static pins.
 *
 * `tiers` apply while `span <= maxSpan`, tightest first; anything wider than
 * every `maxSpan` (and an unknown span) is `fallback`. With `previous`, a span
 * within `hysteresis` of that tier's own edges keeps it, so a pinch around a
 * boundary does not flicker. Example for stops: `[{ maxSpan: 0.012, tier:
 * 'pairs-apart' }, { maxSpan: 0.03, tier: 'full' }]`, fallback `'small'`.
 */
export declare function chooseMapKitSpanTier<TTier extends string>(span: number | null, tiers: ReadonlyArray<MapKitSpanTier<TTier>>, fallback: TTier, previous?: TTier, hysteresis?: number): TTier;
export interface MapKitCollapseOptions<T> {
    /** Items for which this is `false` are never merged into another nor take one in. */
    mergeable?: (item: T) => boolean;
    /** Merge items within this many metres. Default 40: the two sides of one street. */
    maxMetres?: number;
    /** Items for which this is `true` always stand alone (the selected one). */
    pinned?: (item: T) => boolean;
}
/** A kept item and the items it stands for. `members` excludes `item` itself. */
export interface MapKitCollapsedPoint<T> {
    item: T;
    members: T[];
}
/**
 * Collapse points that sit within `maxMetres` of one already kept into that one.
 *
 * The kept item stays on its own real coordinate -- nothing is averaged or
 * invented -- and lists the others in `members`, so the caller can fold their
 * labels or routes into it. Items that are not `mergeable` or are `pinned`
 * always stand alone. Order is the input order, and the first item in a group is
 * the one kept.
 */
export declare function collapseNearbyPoints<T extends LatLng>(items: readonly T[], options?: MapKitCollapseOptions<T>): Array<MapKitCollapsedPoint<T>>;
//# sourceMappingURL=declutter.d.ts.map