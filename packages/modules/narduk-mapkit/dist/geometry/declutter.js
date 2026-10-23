/**
 * Zoom tiers and declutter, decided from what is measured on screen.
 *
 * A marker that is right at one zoom is wrong at another: a 48 px bus badge is
 * fine when buses are a kilometre apart and a pile of overlapping badges when
 * they are not. The rule here is the one the Wave Transit concept shipped, and
 * it is about *pixels*, not zoom levels: **draw the compact form whenever any
 * two markers would be closer on screen than a marker is wide**. That holds at
 * every latitude, screen size and density, and it needs no projection --
 * metres per pixel follows from the visible latitude span and the map's pixel
 * height.
 *
 * Everything here is pure (plain numbers in, plain values out), so it runs
 * without MapKit and is table-testable.
 *
 * - `chooseMapKitMarkerTier` picks `'dot' | 'symbol' | 'detail'` for a set of
 *   markers, with hysteresis so a pinch near the threshold does not flicker.
 * - `chooseMapKitSpanTier` picks a named tier from the latitude span alone, for
 *   static pins (stop dots small until you zoom in, then full size).
 * - `collapseNearbyPoints` merges points that are practically one place into
 *   the first of them, never averaging or inventing a coordinate.
 */
import { haversineDistanceMetres } from './helpers.js';
const METRES_PER_DEGREE_LATITUDE = 111_320;
/** Metres one screen pixel covers, from the visible latitude span and the map's pixel height. */
export function metersPerPixel(latSpanDegrees, mapHeightPx) {
    return (latSpanDegrees * METRES_PER_DEGREE_LATITUDE) / Math.max(1, mapHeightPx);
}
function lngDifference(a, b) {
    return ((((a - b) % 360) + 540) % 360) - 180;
}
/**
 * Whether a point is inside the visible region, plus `padding` of the region's
 * size on every side (default 0.05, so a marker just off the edge still counts).
 * Longitude wraps, so a region across the antimeridian works.
 */
export function isInVisibleRegion(point, region, padding = 0.05) {
    return (Math.abs(point.lat - region.centerLat) <= (region.latDelta / 2) * (1 + 2 * padding) &&
        Math.abs(lngDifference(point.lng, region.centerLng)) <=
            (region.lngDelta / 2) * (1 + 2 * padding));
}
/** The points inside the visible region (see `isInVisibleRegion`); the others cannot overlap anything you can see. */
export function pointsInVisibleRegion(points, region, padding = 0.05) {
    return points.filter((point) => isInVisibleRegion(point, region, padding));
}
/**
 * Two markers this close are at one spot (a layover at the same stop, or one
 * vehicle reported twice). They overlap at every zoom, so they must not hold
 * every other marker in its compact form for good.
 */
export const MAPKIT_SAME_SPOT_METRES = 15;
/**
 * The smallest on-screen gap between any two points, in pixels; `Infinity` with
 * fewer than two. Compares every pair, so it is for tens of points. For
 * thousands use `anyCloserThanPixels`.
 */
export function minSeparationPixels(points, latSpanDegrees, mapHeightPx, options = {}) {
    const sameSpot = options.sameSpotMetres ?? MAPKIT_SAME_SPOT_METRES;
    const mpp = metersPerPixel(latSpanDegrees, mapHeightPx);
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const metres = haversineDistanceMetres(points[i], points[j]);
            if (metres >= sameSpot)
                min = Math.min(min, metres / mpp);
        }
    }
    return min;
}
/**
 * Whether any two points (not at one spot) are closer than `thresholdPx` on
 * screen. Hashes into a grid one threshold wide, so it is linear in the number
 * of points where `minSeparationPixels` is quadratic.
 */
export function anyCloserThanPixels(points, thresholdPx, latSpanDegrees, mapHeightPx, options = {}) {
    if (points.length < 2)
        return false;
    const sameSpot = options.sameSpotMetres ?? MAPKIT_SAME_SPOT_METRES;
    const limit = thresholdPx * metersPerPixel(latSpanDegrees, mapHeightPx);
    if (limit <= sameSpot)
        return false;
    const grid = new MetreGrid(limit, widestLatitude(points));
    for (const [index, point] of points.entries())
        grid.add(point, index);
    for (const [i, point] of points.entries()) {
        for (const j of grid.near(point)) {
            if (j <= i)
                continue;
            const metres = haversineDistanceMetres(point, points[j]);
            if (metres >= sameSpot && metres < limit)
                return true;
        }
    }
    return false;
}
/** A hash grid with cells `cellMetres` wide, for neighbour queries within that distance. */
class MetreGrid {
    #cellLat;
    #cellLng;
    #columns;
    #cells = new Map();
    /** `referenceLat` fixes the longitude cell width, so points can be added one at a time. */
    constructor(cellMetres, referenceLat) {
        this.#cellLat = cellMetres / METRES_PER_DEGREE_LATITUDE;
        this.#cellLng = this.#cellLat / Math.max(Math.cos((referenceLat * Math.PI) / 180), 1e-6);
        this.#columns = Math.max(1, Math.ceil(360 / this.#cellLng));
    }
    add(point, index) {
        const key = this.#key(this.#row(point), this.#column(point));
        const cell = this.#cells.get(key);
        if (cell)
            cell.push(index);
        else
            this.#cells.set(key, [index]);
    }
    /** Indices in this point's cell and the eight around it (columns wrap at the antimeridian), ascending. */
    near(point) {
        const row = this.#row(point);
        const column = this.#column(point);
        const keys = new Set();
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++)
                keys.add(this.#key(row + dr, column + dc));
        }
        const found = [];
        for (const key of keys) {
            const cell = this.#cells.get(key);
            if (cell)
                found.push(...cell);
        }
        return found.sort((x, y) => x - y);
    }
    #row(point) {
        return Math.floor(point.lat / this.#cellLat);
    }
    #column(point) {
        return Math.floor(((((point.lng + 180) % 360) + 360) % 360) / this.#cellLng);
    }
    #key(row, column) {
        return `${String(row)}:${String((column + this.#columns) % this.#columns)}`;
    }
}
/**
 * The latitude that makes grid cells widest in degrees of longitude (the one
 * nearest a pole), so a cell is never narrower than the distance it must cover
 * for any point in the set.
 */
function widestLatitude(points) {
    return Math.min(89, points.reduce((max, point) => Math.max(max, Math.abs(point.lat)), 0));
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
export function chooseMapKitMarkerTier(input) {
    if (input.span === null)
        return input.unknownSpanTier ?? 'symbol';
    const points = input.region
        ? pointsInVisibleRegion(input.points, input.region, input.viewPadding ?? 0.05)
        : input.points;
    const limit = input.markerPx * (input.previous === 'dot' ? (input.hysteresis ?? 1.2) : 1);
    const crowded = anyCloserThanPixels(points, limit, input.span, input.mapHeightPx, {
        sameSpotMetres: input.sameSpotMetres ?? MAPKIT_SAME_SPOT_METRES,
    });
    if (crowded)
        return 'dot';
    return input.detailBelowSpan !== undefined && input.span <= input.detailBelowSpan
        ? 'detail'
        : 'symbol';
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
export function chooseMapKitSpanTier(span, tiers, fallback, previous, hysteresis = 1.15) {
    if (span === null)
        return fallback;
    const sorted = [...tiers].sort((a, b) => a.maxSpan - b.maxSpan);
    const names = [...sorted.map((entry) => entry.tier), fallback];
    const upperOf = (i) => sorted[i]?.maxSpan ?? Number.POSITIVE_INFINITY;
    const lowerOf = (i) => (i === 0 ? 0 : (sorted[i - 1]?.maxSpan ?? 0));
    const found = sorted.findIndex((entry) => span <= entry.maxSpan);
    const raw = found === -1 ? sorted.length : found;
    const held = previous === undefined ? -1 : names.indexOf(previous);
    if (held === -1 || held === raw)
        return names[raw];
    const stays = span > lowerOf(held) / hysteresis && span <= upperOf(held) * hysteresis;
    return names[stays ? held : raw];
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
export function collapseNearbyPoints(items, options = {}) {
    const maxMetres = options.maxMetres ?? 40;
    const mergeable = options.mergeable ?? (() => true);
    const pinned = options.pinned ?? (() => false);
    const out = [];
    const hosts = [];
    const grid = new MetreGrid(maxMetres, widestLatitude(items));
    for (const item of items) {
        if (!mergeable(item) || pinned(item)) {
            out.push({ item, members: [] });
            continue;
        }
        const hostIndex = grid
            .near(item)
            .find((index) => haversineDistanceMetres(hosts[index].item, item) <=
            maxMetres);
        if (hostIndex !== undefined) {
            ;
            hosts[hostIndex].members.push(item);
            continue;
        }
        const entry = { item, members: [] };
        grid.add(item, hosts.length);
        hosts.push(entry);
        out.push(entry);
    }
    return out;
}
//# sourceMappingURL=declutter.js.map