/**
 * Bounding-region arithmetic for `<AppMapKit>`.
 *
 * Pure: it takes points and returns a plain region, so the caller decides when a
 * `mapkit.CoordinateRegion` gets constructed. That keeps the framing rules
 * testable without a map, a namespace, or a DOM.
 */
export interface MapKitLatLng {
    lat: number;
    lng: number;
}
export interface MapKitPlainRegion {
    center: MapKitLatLng;
    span: {
        lat: number;
        lng: number;
    };
}
export interface MapKitBoundsOptions {
    /** Fraction of the natural span added as breathing room. */
    boundingPadding?: number;
    fallbackCenter?: MapKitLatLng | undefined;
    /** Floor for both deltas, so a single point still shows context. */
    minSpanDelta?: number;
}
/**
 * The region that frames every supplied point.
 *
 * Returns `undefined` when there is nothing to frame and no `fallbackCenter`,
 * so a caller can tell "nothing to show" from "show this".
 */
export declare function mapKitBoundingRegion(points: Iterable<MapKitLatLng>, options?: MapKitBoundsOptions): MapKitPlainRegion | undefined;
/** Every `[lng, lat]` pair in a GeoJSON geometry the component renders. */
export declare function mapKitGeometryPoints(geometry: {
    coordinates: unknown;
    type: string;
}): MapKitLatLng[];
//# sourceMappingURL=region.d.ts.map