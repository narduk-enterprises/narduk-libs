import type { MapKitCoordinateLike, MapKitMapLike } from './mapkit-surface.js';
import type { MapKitLatLng } from './region.js';
import type { GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONFeatureProperties, MapKitCircle, OverlayStyle } from '../types.js';
interface OverlayLike {
    enabled: boolean;
    radius?: number;
}
/** The overlay slice of the namespace, separate from `MapKitNamespaceLike`. */
export interface MapKitOverlayNamespaceLike {
    readonly CircleOverlay: new (center: MapKitCoordinateLike, radius: number, options?: object) => OverlayLike;
    readonly Coordinate: new (latitude?: number, longitude?: number) => MapKitCoordinateLike;
    readonly PolygonOverlay: new (points: unknown, options?: object) => OverlayLike;
    readonly PolylineOverlay: new (points: unknown, options?: object) => OverlayLike;
    readonly Style: new (options: object) => object;
}
export interface MapKitOverlayMapLike extends MapKitMapLike {
    addOverlay(overlay: OverlayLike): unknown;
    removeOverlays(overlays: readonly OverlayLike[]): unknown;
}
export interface MapKitOverlayLayerOptions {
    circleScaleFactor?: number;
    dynamicCircleRadius?: boolean;
    map: MapKitOverlayMapLike;
    mapkit: MapKitOverlayNamespaceLike;
    maxCircleRadius?: number;
    minCircleRadius?: number;
    overlayStyleFn?: (properties: GeoJSONFeatureProperties) => OverlayStyle;
}
export declare class MapKitOverlayLayer {
    #private;
    constructor(options: MapKitOverlayLayerOptions);
    /** The feature a `select` event's overlay came from, for `feature-select`. */
    featureFor(overlay: object | undefined): GeoJSONFeature | undefined;
    /**
     * The GeoJSON feature whose filled area contains `point`, if any.
     *
     * A tap handler cannot rely on MapKit's own overlay selection: it needs each
     * overlay `enabled` and a `select` listener, and a consumer that never opted
     * into either would get no `feature-select` at all. Hit-testing the tapped
     * coordinate against the `geojson` prop needs neither, and treats holes as
     * empty by the same even-odd rule the overlays are drawn with (#931).
     * Lines and circles are not hit-tested; a polygon is.
     */
    hitTestFeature(point: MapKitLatLng): GeoJSONFeature | undefined;
    setGeoJSON(collection: GeoJSONFeatureCollection | null): void;
    setCircles(circles: readonly MapKitCircle[]): void;
    /** Scale circle radii with the visible span, as 2.0.x did on `region-change-end`. */
    resizeCirclesToRegion(latitudeDelta: number): void;
    destroy(): void;
}
export {};
//# sourceMappingURL=overlay-layer.d.ts.map