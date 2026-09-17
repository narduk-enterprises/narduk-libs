/**
 * GeoJSON and circle overlays, carried over from 2.0.x unchanged in behaviour.
 *
 * Kept in its own module, behind its own structural namespace type, because
 * `mapkit.Style`, the overlay classes and `map.addOverlay` are members the
 * deterministic fake at `./testing` deliberately does not model: reading one
 * throws rather than answering `undefined`. Nothing here is touched unless the
 * consumer actually passed `geojson` or `circles`, so a pin-only map -- the case
 * every budget in §f measures -- never reaches for them.
 */
import { mapKitGeometryPoints } from './region.js';
/** MapKit Style takes raw hex; Tailwind utilities cannot be used in a JS object. */
const DEFAULT_POLYGON_STYLE = {
    fillColor: '#10b981',
    fillOpacity: 0.2,
    lineWidth: 1.5,
    strokeColor: '#065f46',
    strokeOpacity: 1,
};
const DEFAULT_LINE_STYLE = {
    fillColor: '#000000',
    fillOpacity: 0,
    lineWidth: 3,
    strokeColor: '#0284c7',
    strokeOpacity: 0.92,
};
const METRES_PER_DEGREE_LATITUDE = 111_320;
function ringsFor(mapkit, geometry) {
    const coordinates = geometry.coordinates;
    if (!Array.isArray(coordinates))
        return [];
    const toRings = (polygon) => {
        if (!Array.isArray(polygon))
            return [];
        return polygon
            .filter((ring) => Array.isArray(ring))
            .map((ring) => ring
            .filter((point) => Array.isArray(point) && point.length >= 2)
            .map((point) => new mapkit.Coordinate(point[1], point[0])))
            .filter((ring) => ring.length >= 3);
    };
    if (geometry.type === 'Polygon') {
        const rings = toRings(coordinates);
        return rings.length > 0 ? [rings] : [];
    }
    if (geometry.type === 'MultiPolygon') {
        return coordinates.map(toRings).filter((rings) => rings.length > 0);
    }
    return [];
}
export class MapKitOverlayLayer {
    #circles = [];
    #features = new WeakMap();
    #options;
    #overlays = [];
    constructor(options) {
        this.#options = options;
    }
    /** The feature a `select` event's overlay came from, for `feature-select`. */
    featureFor(overlay) {
        if (!overlay)
            return undefined;
        return this.#features.get(overlay);
    }
    setGeoJSON(collection) {
        this.#clear(this.#overlays);
        if (!collection?.features.length)
            return;
        const { mapkit, overlayStyleFn } = this.#options;
        for (const feature of collection.features) {
            if (feature.geometry.type === 'LineString') {
                const points = mapKitGeometryPoints(feature.geometry).map((point) => new mapkit.Coordinate(point.lat, point.lng));
                if (points.length < 2)
                    continue;
                const style = overlayStyleFn?.(feature.properties) ?? DEFAULT_LINE_STYLE;
                this.#add(new mapkit.PolylineOverlay(points, { style: this.#style(style, 0) }), feature);
                continue;
            }
            const polygons = ringsFor(mapkit, feature.geometry);
            if (polygons.length === 0)
                continue;
            const style = overlayStyleFn?.(feature.properties) ?? DEFAULT_POLYGON_STYLE;
            for (const rings of polygons) {
                const coordinates = rings.length === 1 ? rings[0] : rings;
                this.#add(new mapkit.PolygonOverlay(coordinates, { style: this.#style(style, 0.2) }), feature);
            }
        }
    }
    setCircles(circles) {
        this.#clear(this.#circles);
        if (circles.length === 0)
            return;
        const { mapkit } = this.#options;
        for (const circle of circles) {
            const style = new mapkit.Style({
                fillColor: circle.color,
                fillOpacity: circle.opacity ?? 0.7,
                lineWidth: 0,
                strokeColor: circle.color,
                strokeOpacity: 0,
            });
            const overlay = new mapkit.CircleOverlay(new mapkit.Coordinate(circle.lat, circle.lng), circle.radius, { style });
            this.#circles.push(overlay);
            this.#options.map.addOverlay(overlay);
        }
    }
    /** Scale circle radii with the visible span, as 2.0.x did on `region-change-end`. */
    resizeCirclesToRegion(latitudeDelta) {
        const options = this.#options;
        if (!options.dynamicCircleRadius || this.#circles.length === 0)
            return;
        const raw = latitudeDelta * METRES_PER_DEGREE_LATITUDE * (options.circleScaleFactor ?? 0.004);
        const radius = Math.max(options.minCircleRadius ?? 200, Math.min(options.maxCircleRadius ?? 6000, raw));
        for (const circle of this.#circles)
            circle.radius = radius;
    }
    destroy() {
        this.#clear(this.#overlays);
        this.#clear(this.#circles);
    }
    #style(style, defaultFillOpacity) {
        return new this.#options.mapkit.Style({
            fillColor: style.fillColor,
            fillOpacity: style.fillOpacity ?? defaultFillOpacity,
            fillRule: style.fillRule ?? 'evenodd',
            lineDash: style.lineDash,
            lineWidth: style.lineWidth,
            strokeColor: style.strokeColor,
            strokeOpacity: style.strokeOpacity ?? 1,
        });
    }
    #add(overlay, feature) {
        overlay.enabled = true;
        this.#features.set(overlay, feature);
        this.#overlays.push(overlay);
        this.#options.map.addOverlay(overlay);
    }
    #clear(bucket) {
        if (bucket.length === 0)
            return;
        this.#options.map.removeOverlays([...bucket]);
        bucket.length = 0;
    }
}
//# sourceMappingURL=overlay-layer.js.map