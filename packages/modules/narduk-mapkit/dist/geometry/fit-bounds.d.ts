/**
 * Fit a longitude/latitude box into a map of a known pixel size.
 *
 * `computeMapKitRegionForLngLatBounds` pads a box and hands MapKit its two
 * spans, and leaves the rest to MapKit: how a region that does not match the
 * canvas's aspect is fitted. That is fine for a map the size you expect, and
 * wrong for a card that is much wider than it is tall, because the box's
 * centre and the span MapKit reads as "latitude" are both Mercator questions:
 *
 * - MapKit centres the visible rectangle on the region's centre in Mercator
 *   space, and sizes it so the latitude *difference* between its top and bottom
 *   edges is `latitudeDelta`. A centre that is the plain average of the
 *   box's latitudes is not the box's middle on screen (the difference grows with
 *   latitude: about 1 degree for Alaska), so a box fitted tight at its top is
 *   cut there and has room at its bottom.
 * - A box that is wide for the canvas is bound by its height, and a tall one by
 *   its width; the fit is the tighter of the two.
 *
 * This works the fit out in Mercator space from the canvas's own pixel size,
 * so the whole box (plus `padding`) is visible whatever the aspect, and the
 * returned region reads back from MapKit as the box. Plain numbers in and out:
 * no `mapkit` global, safe in SSR and tests.
 */
import type { MapKitRegion } from '../types.js';
import type { MapKitLngLatBounds } from './geometry.js';
export interface MapKitViewport {
    /** The canvas's height in CSS pixels. */
    height: number;
    /** The canvas's width in CSS pixels. */
    width: number;
}
export interface MapKitFitOptions {
    /** Room kept around the box on each side, as a fraction of its size. Default 0.12. */
    padding?: number;
    /**
     * The smallest the visible area may be on either axis, in degrees of
     * longitude (on screen, so latitude counts as its Mercator equivalent). A
     * single gauge is not a street map. Default 0.
     */
    minSpanDegrees?: number;
}
/** Latitude to its Mercator ordinate, in degrees (the unit longitude is in). */
export declare function mercatorDegreesFromLatitude(lat: number): number;
/** The inverse of `mercatorDegreesFromLatitude`. */
export declare function latitudeFromMercatorDegrees(mercator: number): number;
/**
 * The MapKit region that shows `bounds` (`[west, south, east, north]`, degrees)
 * whole in a canvas of `viewport` pixels, or `null` for a box or canvas that is
 * not finite. A box that crosses the antimeridian (`east < west`) is read as
 * the short way round.
 */
export declare function fitMapKitRegionToViewport(bounds: MapKitLngLatBounds, viewport: MapKitViewport, options?: MapKitFitOptions): MapKitRegion | null;
//# sourceMappingURL=fit-bounds.d.ts.map