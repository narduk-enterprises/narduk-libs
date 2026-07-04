import type { MapKitCircleDrawable, MapKitCircleDrawableV2, MapKitGeoJSONFeatureCollectionV2, MapKitGeoJSONFeatureV2, MapKitLatLng, MapKitLineDrawable, MapKitLineDrawableV2, MapKitLineHitV2, MapKitMarkerDrawable, MapKitMarkerDrawableV2, MapKitOverlaySelection, MapKitPoint, MapKitPolygonDrawable, MapKitPolygonDrawableV2, MapKitRegion, MapKitRegionSpan } from '../types.js';
export interface MapKitGeoJsonGeometry {
    coordinates: unknown;
    type: string;
}
export interface MapKitGeoJsonFeature {
    geometry: MapKitGeoJsonGeometry;
    id?: number | string;
    properties?: Record<string, unknown>;
    type: 'Feature';
}
export interface MapKitGeoJsonFeatureCollection {
    features: MapKitGeoJsonFeature[];
    type: 'FeatureCollection';
}
export interface MapKitLineHit<TData = unknown> {
    distanceMetres: number;
    overlay: MapKitLineDrawable<TData>;
    segmentIndex: number;
}
export type MapKitLngLatBounds = readonly [
    westLng: number,
    southLat: number,
    eastLng: number,
    northLat: number
];
export interface MapKitRegionOptions {
    fallbackCenter?: MapKitPointLike | null;
    fallbackSpan?: MapKitRegionSpan | null;
    minSpanDelta?: number;
    padding?: number;
}
export interface MapKitDrawableRegionInput {
    circles?: ReadonlyArray<MapKitCircleDrawable | MapKitCircleDrawableV2> | null;
    geojson?: MapKitGeoJsonFeature | MapKitGeoJsonFeatureCollection | MapKitGeoJsonGeometry | null;
    lines?: ReadonlyArray<MapKitLineDrawable | MapKitLineDrawableV2> | null;
    markers?: ReadonlyArray<MapKitMarkerDrawable | MapKitMarkerDrawableV2> | null;
    points?: readonly MapKitPointLike[] | null;
    polygons?: ReadonlyArray<MapKitPolygonDrawable | MapKitPolygonDrawableV2> | null;
}
export declare function normalizeCircleOverlay(circle: MapKitCircleDrawable): MapKitCircleDrawable | null;
export declare function extractGeoJsonPoints(geometry: MapKitGeoJsonGeometry): MapKitLatLng[];
export declare function geoJsonFeatureToLineDrawables(feature: MapKitGeoJsonFeature, featureIndex?: number): Array<MapKitLineDrawable<MapKitGeoJsonFeature>>;
export declare function geoJsonFeatureToPolygonDrawables(feature: MapKitGeoJsonFeature, featureIndex?: number): Array<MapKitPolygonDrawable<MapKitGeoJsonFeature>>;
export declare function geoJsonToLineDrawables(collection: MapKitGeoJsonFeatureCollection | null | undefined): Array<MapKitLineDrawable<MapKitGeoJsonFeature>>;
export declare function geoJsonToPolygonDrawables(collection: MapKitGeoJsonFeatureCollection | null | undefined): Array<MapKitPolygonDrawable<MapKitGeoJsonFeature>>;
export declare function measureLineDistanceMetres(points: readonly MapKitLatLng[]): number;
export declare function fallbackMapKitRegion(options?: MapKitRegionOptions): MapKitRegion | null;
export declare function computeMapKitRegionForPoints(points: readonly MapKitPointLike[] | null | undefined, options?: MapKitRegionOptions): MapKitRegion | null;
export declare function computeMapKitRegionForLngLatBounds(bounds: MapKitLngLatBounds | null | undefined, options?: MapKitRegionOptions): MapKitRegion | null;
export declare function collectMapKitPointsFromGeoJson(input: MapKitGeoJsonFeature | MapKitGeoJsonFeatureCollection | MapKitGeoJsonGeometry | null | undefined): MapKitPoint[];
export declare function computeMapKitRegionForGeoJson(input: MapKitGeoJsonFeature | MapKitGeoJsonFeatureCollection | MapKitGeoJsonGeometry | null | undefined, options?: MapKitRegionOptions): MapKitRegion | null;
export declare function collectMapKitDrawablePoints(input: MapKitDrawableRegionInput): MapKitPoint[];
export declare function computeMapKitRegionForDrawables(input: MapKitDrawableRegionInput, options?: MapKitRegionOptions): MapKitRegion | null;
export declare function hitTestLineOverlays<TData = unknown>(point: MapKitLatLng, overlays: ReadonlyArray<MapKitLineDrawable<TData>>, toleranceMetres?: number): MapKitLineHit<TData> | null;
export declare function pointInPolygon(point: MapKitLatLng, ring: readonly MapKitLatLng[]): boolean;
export declare function hitTestPolygonOverlays<TData = unknown>(point: MapKitLatLng, overlays: ReadonlyArray<MapKitPolygonDrawable<TData>>): MapKitPolygonDrawable<TData> | null;
export declare function hitTestCircleOverlays<TData = unknown>(point: MapKitLatLng, overlays: ReadonlyArray<MapKitCircleDrawable<TData>>): MapKitCircleDrawable<TData> | null;
export declare function buildOverlaySelection<TData = unknown>(kind: MapKitOverlaySelection<TData>['kind'], id: string, data?: TData, coordinate?: MapKitLatLng): MapKitOverlaySelection<TData>;
export interface MapKitPointLike {
    lat: number;
    lng: number;
}
export declare function normalizeMapKitPoint(point: MapKitPointLike | null | undefined): MapKitPoint | null;
export declare function normalizeMapKitMarkerCoordinate(point: MapKitPointLike | null | undefined): MapKitPoint | null;
export declare function normalizeMapKitLineCoordinates(points: readonly MapKitPointLike[] | null | undefined): MapKitPoint[];
export declare function normalizeMapKitPolygonCoordinates(rings: ReadonlyArray<readonly MapKitPointLike[]> | null | undefined): ReadonlyArray<readonly MapKitPoint[]>;
export declare function normalizeMapKitRegion(region: MapKitRegion | null | undefined): MapKitRegion | null;
export declare function normalizeMapKitSpan(span: MapKitRegionSpan | null | undefined): MapKitRegionSpan | null;
export declare function expandGeoJSONMultiLineStringFeatures<TProperties extends Record<string, unknown> = Record<string, unknown>>(input: MapKitGeoJSONFeatureCollectionV2<TProperties> | ReadonlyArray<MapKitGeoJSONFeatureV2<TProperties>>): MapKitGeoJSONFeatureCollectionV2<TProperties> | Array<MapKitGeoJSONFeatureV2<TProperties>>;
export declare function computeRouteDistanceMetres(points: readonly MapKitPointLike[] | null | undefined): number;
export declare function findNearestMapKitLineHit(lines: readonly MapKitLineDrawableV2[] | null | undefined, point: MapKitPointLike, tolerance?: {
    lat: number;
    lng: number;
}): MapKitLineHitV2 | null;
//# sourceMappingURL=geometry.d.ts.map