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
const DEG = 180 / Math.PI;
/** Mercator stops being finite at the poles; web maps stop here. */
const MAX_MERCATOR_LATITUDE = 85.0511;
function clampLat(lat) {
    return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat));
}
/** Latitude to its Mercator ordinate, in degrees (the unit longitude is in). */
export function mercatorDegreesFromLatitude(lat) {
    return Math.log(Math.tan(Math.PI / 4 + clampLat(lat) / DEG / 2)) * DEG;
}
/** The inverse of `mercatorDegreesFromLatitude`. */
export function latitudeFromMercatorDegrees(mercator) {
    return (2 * Math.atan(Math.exp(mercator / DEG)) - Math.PI / 2) * DEG;
}
/**
 * The MapKit region that shows `bounds` (`[west, south, east, north]`, degrees)
 * whole in a canvas of `viewport` pixels, or `null` for a box or canvas that is
 * not finite. A box that crosses the antimeridian (`east < west`) is read as
 * the short way round.
 */
export function fitMapKitRegionToViewport(bounds, viewport, options = {}) {
    const [west, south, east, north] = bounds;
    const { height, width } = viewport;
    if (![west, south, east, north, width, height].every(Number.isFinite))
        return null;
    if (width <= 0 || height <= 0)
        return null;
    const padding = Math.max(0, options.padding ?? 0.12);
    const minSpan = Math.max(0, options.minSpanDegrees ?? 0);
    const rawWidth = east - west;
    const boxWidth = Math.min(360, rawWidth >= 0 ? rawWidth : rawWidth + 360);
    const southMercator = mercatorDegreesFromLatitude(Math.min(south, north));
    const northMercator = mercatorDegreesFromLatitude(Math.max(south, north));
    const boxHeight = northMercator - southMercator;
    const wantWidth = Math.max(boxWidth * (1 + padding * 2), minSpan);
    const wantHeight = Math.max(boxHeight * (1 + padding * 2), minSpan);
    // Degrees per pixel: the tighter axis decides, the other gets the slack.
    const scale = Math.max(wantWidth / width, wantHeight / height);
    const visibleWidth = Math.min(360, scale * width);
    const visibleHeight = scale * height;
    const middleMercator = (southMercator + northMercator) / 2;
    const centerLat = latitudeFromMercatorDegrees(middleMercator);
    const top = latitudeFromMercatorDegrees(middleMercator + visibleHeight / 2);
    const bottom = latitudeFromMercatorDegrees(middleMercator - visibleHeight / 2);
    let centerLng = west + boxWidth / 2;
    if (centerLng > 180)
        centerLng -= 360;
    return {
        center: { lat: centerLat, lng: centerLng },
        span: { latDelta: top - bottom, lngDelta: visibleWidth },
    };
}
//# sourceMappingURL=fit-bounds.js.map