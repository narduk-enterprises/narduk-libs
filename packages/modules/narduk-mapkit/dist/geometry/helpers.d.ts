/**
 * Standalone MapKit utility helpers for downstream apps.
 *
 * These helpers operate on plain coordinate data (no mapkit global required)
 * and are safe to call in browser code, server utilities, or anywhere coordinate
 * arithmetic is needed before the MapKit SDK loads.
 *
 * MapKit-SDK-dependent helpers (e.g. `CoordinateRegion` construction) are
 * intentionally kept out of this file so it can be imported without a browser
 * context or without MapKit being initialized.
 *
 * These helpers intentionally avoid the MapKit JS runtime so they can run
 * during SSR, local data prep, or tests.
 */
/** A latitude/longitude pair. */
export interface LatLng {
    lat: number;
    lng: number;
}
/** A bounding box computed from a set of coordinate points. */
export interface CoordinateBounds {
    centerLat: number;
    centerLng: number;
    /** True when the shortest longitude span crosses ±180°. */
    crossesAntimeridian: boolean;
    /** Eastern edge of the shortest longitude span. May be less than westLng. */
    eastLng: number;
    /** Total latitude span (degrees, always ≥ minSpanDelta). */
    latDelta: number;
    /** Total longitude span (degrees, always ≥ minSpanDelta). */
    lngDelta: number;
    maxLat: number;
    /** Maximum numeric longitude in the input set. */
    maxLng: number;
    minLat: number;
    /** Minimum numeric longitude in the input set. */
    minLng: number;
    /** Western edge of the shortest longitude span. */
    westLng: number;
}
/**
 * Clamp a latitude value to the valid MapKit range [-90, 90].
 *
 * Apple MapKit silently ignores out-of-range coordinates in some contexts and
 * throws in others. Always normalise before passing user-supplied or
 * API-sourced coordinates to MapKit.
 */
export declare function clampLatitude(lat: number): number;
/**
 * Clamp a longitude value to the valid MapKit range [-180, 180].
 */
export declare function clampLongitude(lng: number): number;
/**
 * Return a coordinate with both values clamped to valid MapKit ranges and
 * rounded to 6 decimal places (≈ 0.1 m precision, sufficient for map display).
 */
export declare function normalizeCoordinate(lat: number, lng: number): LatLng;
/**
 * Return `true` when both values are finite numbers in the valid MapKit
 * coordinate range. Use this to filter API/user input before passing to MapKit.
 */
export declare function isValidCoordinate(lat: unknown, lng: unknown): boolean;
/**
 * Compute the bounding box that encloses all supplied coordinate points.
 *
 * Returns `null` when the input array is empty or contains no valid
 * coordinates.
 *
 * @param points   Array of `{ lat, lng }` objects.
 * @param padding  Fractional padding added around all sides (default 0.05 = 5%).
 * @param minSpanDelta  Minimum span in degrees so small clusters still show
 *                      geographic context (default 0.01).
 */
export declare function computeCoordinateBounds(points: LatLng[], padding?: number, minSpanDelta?: number): CoordinateBounds | null;
/**
 * Compute approximate distance in metres between two coordinates using the
 * Haversine formula (spherical earth).
 *
 * Accurate to within ≈ 0.5% for distances up to a few hundred kilometres —
 * sufficient for map zoom decisions and clustering radius calculations.
 */
export declare function haversineDistanceMetres(a: LatLng, b: LatLng): number;
/**
 * Group a flat array of items into spatial clusters using a simple grid-based
 * approach.
 *
 * This is a lightweight alternative to full DBSCAN/KMeans for situations where
 * the MapKit built-in `clusteringIdentifier` prop is not sufficient (e.g. when
 * you need cluster data on the server or before the SDK loads).
 *
 * @param items           Items to cluster. Each must have `lat` and `lng`.
 * @param gridSizeDegrees Grid cell size in degrees (default 0.5 ≈ 55 km).
 */
export declare function gridCluster<T extends LatLng>(items: T[], gridSizeDegrees?: number): Array<{
    center: LatLng;
    count: number;
    items: T[];
}>;
//# sourceMappingURL=helpers.d.ts.map