import { computeCoordinateBounds, haversineDistanceMetres, isValidCoordinate, normalizeCoordinate, } from './helpers.js';
const DEFAULT_REGION_PADDING = 0.05;
const DEFAULT_REGION_MIN_SPAN_DELTA = 0.01;
function readLngLatPair(value) {
    if (!Array.isArray(value) || value.length < 2)
        return null;
    const [lng, lat] = value;
    if (!isValidCoordinate(lat, lng))
        return null;
    return { lat, lng };
}
function readLineString(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((point) => {
        const coordinate = readLngLatPair(point);
        return coordinate ? [coordinate] : [];
    });
}
function readPolygon(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((ring) => {
        const coordinates = readLineString(ring);
        return coordinates.length >= 3 ? [coordinates] : [];
    });
}
export function normalizeCircleOverlay(circle) {
    const center = circle.center ?? { lat: circle.lat, lng: circle.lng };
    const { lat, lng } = center;
    if (typeof lat !== 'number' || typeof lng !== 'number')
        return null;
    if (!isValidCoordinate(lat, lng))
        return null;
    if (!Number.isFinite(circle.radius) || circle.radius <= 0)
        return null;
    return {
        ...circle,
        center: { lat, lng },
    };
}
export function extractGeoJsonPoints(geometry) {
    if (geometry.type === 'Point') {
        const point = readLngLatPair(geometry.coordinates);
        return point ? [point] : [];
    }
    if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
        return readLineString(geometry.coordinates);
    }
    if (geometry.type === 'MultiLineString') {
        if (!Array.isArray(geometry.coordinates))
            return [];
        return geometry.coordinates.flatMap(readLineString);
    }
    if (geometry.type === 'Polygon') {
        return readPolygon(geometry.coordinates).flat();
    }
    if (geometry.type === 'MultiPolygon') {
        if (!Array.isArray(geometry.coordinates))
            return [];
        return geometry.coordinates.flatMap((polygon) => readPolygon(polygon).flat());
    }
    return [];
}
function featureKey(feature, index) {
    const id = feature.id ?? feature.properties?.id ?? feature.properties?.slug ?? feature.properties?.name;
    return id === undefined ? String(index) : String(id);
}
export function geoJsonFeatureToLineDrawables(feature, featureIndex = 0) {
    const baseId = `geojson:${featureKey(feature, featureIndex)}`;
    if (feature.geometry.type === 'LineString') {
        const coordinates = readLineString(feature.geometry.coordinates);
        return coordinates.length >= 2 ? [{ id: `${baseId}:line:0`, coordinates, data: feature }] : [];
    }
    if (feature.geometry.type !== 'MultiLineString' || !Array.isArray(feature.geometry.coordinates)) {
        return [];
    }
    return feature.geometry.coordinates.flatMap((line, lineIndex) => {
        const coordinates = readLineString(line);
        return coordinates.length >= 2
            ? [{ id: `${baseId}:line:${lineIndex}`, coordinates, data: feature }]
            : [];
    });
}
export function geoJsonFeatureToPolygonDrawables(feature, featureIndex = 0) {
    const baseId = `geojson:${featureKey(feature, featureIndex)}`;
    if (feature.geometry.type === 'Polygon') {
        const rings = readPolygon(feature.geometry.coordinates);
        return rings.length > 0 ? [{ id: `${baseId}:polygon:0`, rings, data: feature }] : [];
    }
    if (feature.geometry.type !== 'MultiPolygon' || !Array.isArray(feature.geometry.coordinates)) {
        return [];
    }
    return feature.geometry.coordinates.flatMap((polygon, polygonIndex) => {
        const rings = readPolygon(polygon);
        return rings.length > 0
            ? [{ id: `${baseId}:polygon:${polygonIndex}`, rings, data: feature }]
            : [];
    });
}
export function geoJsonToLineDrawables(collection) {
    return (collection?.features.flatMap((feature, index) => geoJsonFeatureToLineDrawables(feature, index)) ?? []);
}
export function geoJsonToPolygonDrawables(collection) {
    return (collection?.features.flatMap((feature, index) => geoJsonFeatureToPolygonDrawables(feature, index)) ?? []);
}
export function measureLineDistanceMetres(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += haversineDistanceMetres(points[i - 1], points[i]);
    }
    return total;
}
function regionOptionsPadding(options) {
    return options.padding ?? DEFAULT_REGION_PADDING;
}
function regionOptionsMinSpanDelta(options) {
    return options.minSpanDelta ?? DEFAULT_REGION_MIN_SPAN_DELTA;
}
function regionFromCoordinateBounds(bounds) {
    return {
        center: normalizeCoordinate(bounds.centerLat, bounds.centerLng),
        span: {
            latDelta: bounds.latDelta,
            lngDelta: bounds.lngDelta,
        },
    };
}
export function fallbackMapKitRegion(options = {}) {
    const center = normalizeMapKitPoint(options.fallbackCenter);
    const span = normalizeMapKitSpan(options.fallbackSpan);
    if (!center || !span)
        return null;
    return { center, span };
}
export function computeMapKitRegionForPoints(points, options = {}) {
    if (!Array.isArray(points))
        return fallbackMapKitRegion(options);
    const normalized = points
        .map((point) => normalizeMapKitPoint(point))
        .filter((point) => point !== null);
    const bounds = computeCoordinateBounds(normalized, regionOptionsPadding(options), regionOptionsMinSpanDelta(options));
    return bounds ? regionFromCoordinateBounds(bounds) : fallbackMapKitRegion(options);
}
export function computeMapKitRegionForLngLatBounds(bounds, options = {}) {
    if (!bounds)
        return fallbackMapKitRegion(options);
    const [westLng, southLat, eastLng, northLat] = bounds;
    if (!isFiniteNumber(westLng) ||
        !isFiniteNumber(southLat) ||
        !isFiniteNumber(eastLng) ||
        !isFiniteNumber(northLat)) {
        return fallbackMapKitRegion(options);
    }
    const south = clamp(southLat, -90, 90);
    const north = clamp(northLat, -90, 90);
    const minLat = Math.min(south, north);
    const maxLat = Math.max(south, north);
    const rawLngDelta = eastLng - westLng;
    if (Math.abs(rawLngDelta) >= 360) {
        return regionFromCoordinateBounds({
            centerLat: (minLat + maxLat) / 2,
            centerLng: 0,
            latDelta: Math.max((maxLat - minLat) * (1 + regionOptionsPadding(options)), regionOptionsMinSpanDelta(options)),
            lngDelta: 360,
        });
    }
    const lngDelta = rawLngDelta >= 0 ? rawLngDelta : rawLngDelta + 360;
    const paddedLngDelta = Math.max(lngDelta * (1 + regionOptionsPadding(options)), regionOptionsMinSpanDelta(options));
    const latDelta = Math.max((maxLat - minLat) * (1 + regionOptionsPadding(options)), regionOptionsMinSpanDelta(options));
    return regionFromCoordinateBounds({
        centerLat: (minLat + maxLat) / 2,
        centerLng: normalizeLongitudeDegrees(westLng + lngDelta / 2),
        latDelta,
        lngDelta: paddedLngDelta,
    });
}
export function collectMapKitPointsFromGeoJson(input) {
    if (!input)
        return [];
    if (isGeoJsonFeatureCollectionInput(input)) {
        return input.features.flatMap((feature) => collectMapKitPointsFromGeoJson(feature));
    }
    if (isGeoJsonFeatureInput(input)) {
        return extractGeoJsonPoints(input.geometry).flatMap((point) => {
            const normalized = normalizeMapKitPoint(point);
            return normalized ? [normalized] : [];
        });
    }
    return extractGeoJsonPoints(input).flatMap((point) => {
        const normalized = normalizeMapKitPoint(point);
        return normalized ? [normalized] : [];
    });
}
function isGeoJsonFeatureCollectionInput(input) {
    return (input.type === 'FeatureCollection' && Array.isArray(input.features));
}
function isGeoJsonFeatureInput(input) {
    return input.type === 'Feature' && typeof input.geometry === 'object';
}
export function computeMapKitRegionForGeoJson(input, options = {}) {
    return computeMapKitRegionForPoints(collectMapKitPointsFromGeoJson(input), options);
}
function collectMarkerPoint(marker) {
    return 'point' in marker ? normalizeMapKitPoint(marker.point) : normalizeMapKitPoint(marker);
}
function collectLinePoints(line) {
    return normalizeMapKitLineCoordinates('points' in line ? line.points : line.coordinates);
}
function collectPolygonPoints(polygon) {
    return normalizeMapKitPolygonCoordinates(polygon.rings).flatMap((ring) => [...ring]);
}
function collectCirclePoint(circle) {
    if ('radiusMetres' in circle)
        return normalizeMapKitPoint(circle.center);
    const normalized = normalizeCircleOverlay(circle);
    return normalized?.center ? normalizeMapKitPoint(normalized.center) : null;
}
export function collectMapKitDrawablePoints(input) {
    const points = [];
    if (input.points) {
        for (const point of input.points) {
            const normalized = normalizeMapKitPoint(point);
            if (normalized)
                points.push(normalized);
        }
    }
    if (input.markers) {
        for (const marker of input.markers) {
            const point = collectMarkerPoint(marker);
            if (point)
                points.push(point);
        }
    }
    if (input.lines) {
        for (const line of input.lines) {
            points.push(...collectLinePoints(line));
        }
    }
    if (input.polygons) {
        for (const polygon of input.polygons) {
            points.push(...collectPolygonPoints(polygon));
        }
    }
    if (input.circles) {
        for (const circle of input.circles) {
            const point = collectCirclePoint(circle);
            if (point)
                points.push(point);
        }
    }
    if (input.geojson) {
        points.push(...collectMapKitPointsFromGeoJson(input.geojson));
    }
    return points;
}
export function computeMapKitRegionForDrawables(input, options = {}) {
    return computeMapKitRegionForPoints(collectMapKitDrawablePoints(input), options);
}
function closestPointOnSegment(point, start, end) {
    const x = point.lng;
    const y = point.lat;
    const x1 = start.lng;
    const y1 = start.lat;
    const x2 = end.lng;
    const y2 = end.lat;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const denominator = dx * dx + dy * dy;
    if (denominator === 0)
        return start;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / denominator));
    return { lat: y1 + t * dy, lng: x1 + t * dx };
}
export function hitTestLineOverlays(point, overlays, toleranceMetres = 30) {
    let best = null;
    for (const overlay of overlays) {
        for (let i = 1; i < overlay.coordinates.length; i++) {
            const projected = closestPointOnSegment(point, overlay.coordinates[i - 1], overlay.coordinates[i]);
            const distanceMetres = haversineDistanceMetres(point, projected);
            if (distanceMetres > toleranceMetres)
                continue;
            if (!best || distanceMetres < best.distanceMetres) {
                best = { overlay, segmentIndex: i - 1, distanceMetres };
            }
        }
    }
    return best;
}
export function pointInPolygon(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const current = ring[i];
        const previous = ring[j];
        const intersects = current.lng > point.lng !== previous.lng > point.lng &&
            point.lat <
                ((previous.lat - current.lat) * (point.lng - current.lng)) / (previous.lng - current.lng) +
                    current.lat;
        if (intersects)
            inside = !inside;
    }
    return inside;
}
/**
 * The first polygon whose filled area contains `point`. `rings` is
 * `[outer, ...holes]` (GeoJSON order), and the overlay layer draws the holes
 * empty, so containment is even-odd across rings: a point inside the outer
 * ring and inside one hole is not on the polygon (#931).
 */
export function hitTestPolygonOverlays(point, overlays) {
    return (overlays.find((overlay) => overlay.rings.reduce((inside, ring) => (pointInPolygon(point, ring) ? !inside : inside), false)) ?? null);
}
export function hitTestCircleOverlays(point, overlays) {
    return (overlays.find((overlay) => {
        const normalized = normalizeCircleOverlay(overlay);
        return normalized?.center
            ? haversineDistanceMetres(point, normalized.center) <= normalized.radius
            : false;
    }) ?? null);
}
export function buildOverlaySelection(kind, id, data, coordinate) {
    return {
        id,
        kind,
        ...(data !== undefined ? { data } : {}),
        ...(coordinate !== undefined ? { coordinate } : {}),
    };
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isPointLike(value) {
    return (typeof value === 'object' &&
        value !== null &&
        isFiniteNumber(value.lat) &&
        isFiniteNumber(value.lng));
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function normalizeLongitudeDegrees(lng) {
    const normalized = ((((lng + 180) % 360) + 360) % 360) - 180;
    return Object.is(normalized, -0) ? 0 : normalized;
}
function shortestLongitudeDeltaDegrees(fromLng, toLng) {
    let delta = toLng - fromLng;
    if (delta > 180)
        delta -= 360;
    if (delta < -180)
        delta += 360;
    return delta;
}
function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}
function normalizeMapKitPointInternal(point) {
    return normalizeCoordinate(point.lat, point.lng);
}
function segmentClosestPointV2(point, segmentStart, segmentEnd) {
    const lngScale = Math.max(Math.abs(Math.cos(toRadians(point.lat))), 1e-6);
    const ax = shortestLongitudeDeltaDegrees(point.lng, segmentStart.lng) * lngScale;
    const ay = segmentStart.lat - point.lat;
    const bx = shortestLongitudeDeltaDegrees(point.lng, segmentEnd.lng) * lngScale;
    const by = segmentEnd.lat - point.lat;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = -ax;
    const apy = -ay;
    const denom = abx * abx + aby * aby;
    const t = denom > 0 ? clamp((apx * abx + apy * aby) / denom, 0, 1) : 0;
    const closestX = ax + abx * t;
    const closestY = ay + aby * t;
    return {
        lat: point.lat + closestY,
        lng: normalizeLongitudeDegrees(point.lng + closestX / lngScale),
    };
}
function normalizeGeoJSONLineStringV2(coordinates) {
    const points = coordinates
        .filter((coordinate) => {
        return (Array.isArray(coordinate) &&
            coordinate.length >= 2 &&
            isFiniteNumber(coordinate[0]) &&
            isFiniteNumber(coordinate[1]));
    })
        .map((coordinate) => [coordinate[0], coordinate[1]]);
    if (points.length < 2)
        return null;
    return { type: 'LineString', coordinates: points };
}
function normalizeGeoJSONPolygonV2(coordinates) {
    const rings = [];
    for (const ring of coordinates) {
        if (!Array.isArray(ring))
            continue;
        const points = ring
            .filter((coordinate) => {
            return (Array.isArray(coordinate) &&
                coordinate.length >= 2 &&
                isFiniteNumber(coordinate[0]) &&
                isFiniteNumber(coordinate[1]));
        })
            .map((coordinate) => [coordinate[0], coordinate[1]]);
        if (points.length >= 3)
            rings.push(points);
    }
    if (rings.length === 0)
        return null;
    return { type: 'Polygon', coordinates: rings };
}
function normalizeGeoJSONPointV2(coordinates) {
    if (coordinates.length < 2 ||
        !isFiniteNumber(coordinates[0]) ||
        !isFiniteNumber(coordinates[1])) {
        return null;
    }
    return { type: 'Point', coordinates: [coordinates[0], coordinates[1]] };
}
function normalizeGeoJSONGeometryV2(geometry) {
    if (geometry.type === 'Point')
        return normalizeGeoJSONPointV2(geometry.coordinates);
    if (geometry.type === 'LineString')
        return normalizeGeoJSONLineStringV2(geometry.coordinates);
    if (geometry.type === 'Polygon')
        return normalizeGeoJSONPolygonV2(geometry.coordinates);
    return geometry;
}
function isGeoJsonFeatureArray(input) {
    return Array.isArray(input);
}
export function normalizeMapKitPoint(point) {
    if (!isPointLike(point))
        return null;
    return normalizeMapKitPointInternal(point);
}
export function normalizeMapKitMarkerCoordinate(point) {
    return normalizeMapKitPoint(point);
}
export function normalizeMapKitLineCoordinates(points) {
    if (!Array.isArray(points))
        return [];
    const normalized = points
        .map((point) => normalizeMapKitPoint(point))
        .filter((point) => point !== null);
    return normalized.length >= 2 ? normalized : [];
}
export function normalizeMapKitPolygonCoordinates(rings) {
    if (!Array.isArray(rings))
        return [];
    return rings
        .map((ring) => normalizeMapKitLineCoordinates(ring))
        .filter((ring) => ring.length >= 3);
}
export function normalizeMapKitRegion(region) {
    if (!region)
        return null;
    const center = normalizeMapKitPoint(region.center);
    const span = normalizeMapKitSpan(region.span);
    if (!center || !span)
        return null;
    return { center, span };
}
export function normalizeMapKitSpan(span) {
    if (!span)
        return null;
    if (!isFiniteNumber(span.latDelta) || !isFiniteNumber(span.lngDelta))
        return null;
    return {
        latDelta: Math.max(0, Math.round(Math.abs(span.latDelta) * 1_000_000) / 1_000_000),
        lngDelta: Math.max(0, Math.round(Math.abs(span.lngDelta) * 1_000_000) / 1_000_000),
    };
}
export function expandGeoJSONMultiLineStringFeatures(input) {
    const isFeatureArray = isGeoJsonFeatureArray(input);
    const features = isFeatureArray ? input : input.features;
    const expanded = [];
    for (const feature of features) {
        const geometry = normalizeGeoJSONGeometryV2(feature.geometry);
        if (!geometry)
            continue;
        if (geometry.type !== 'MultiLineString') {
            expanded.push({ ...feature, geometry });
            continue;
        }
        for (const line of geometry.coordinates) {
            const lineGeometry = normalizeGeoJSONLineStringV2(line);
            if (!lineGeometry)
                continue;
            expanded.push({
                ...feature,
                geometry: lineGeometry,
            });
        }
    }
    return isFeatureArray ? expanded : { type: 'FeatureCollection', features: expanded };
}
export function computeRouteDistanceMetres(points) {
    const normalized = normalizeMapKitLineCoordinates(points);
    if (normalized.length < 2)
        return 0;
    let total = 0;
    for (let index = 1; index < normalized.length; index++) {
        total += haversineDistanceMetres(normalized[index - 1], normalized[index]);
    }
    return total;
}
export function findNearestMapKitLineHit(lines, point, tolerance = { lat: 0.01, lng: 0.01 }) {
    if (!Array.isArray(lines) || !isPointLike(point))
        return null;
    if (!isFiniteNumber(tolerance.lat) ||
        !isFiniteNumber(tolerance.lng) ||
        tolerance.lat < 0 ||
        tolerance.lng < 0) {
        return null;
    }
    const target = normalizeMapKitPointInternal(point);
    let nearest = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (!line || line.points.length < 2)
            continue;
        const points = line.points
            .map((candidate) => normalizeMapKitPoint(candidate))
            .filter((candidate) => candidate !== null);
        if (points.length < 2)
            continue;
        for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex++) {
            const closestPoint = segmentClosestPointV2(target, points[segmentIndex - 1], points[segmentIndex]);
            if (!closestPoint)
                continue;
            const latOffset = Math.abs(closestPoint.lat - target.lat);
            const lngOffset = Math.abs(shortestLongitudeDeltaDegrees(target.lng, closestPoint.lng));
            if (latOffset > tolerance.lat || lngOffset > tolerance.lng)
                continue;
            const distanceMetres = haversineDistanceMetres(target, closestPoint);
            const distanceDegrees = Math.hypot(latOffset, lngOffset);
            if (!nearest || distanceMetres < nearest.distanceMetres) {
                nearest = {
                    closestPoint,
                    distanceDegrees,
                    distanceMetres,
                    latOffset,
                    line,
                    lineIndex,
                    lngOffset,
                    segmentIndex: segmentIndex - 1,
                };
            }
        }
    }
    return nearest;
}
//# sourceMappingURL=geometry.js.map