import { computeMapKitRegionForLngLatBounds } from '../geometry/geometry.js';
import { createMapKitCoordinateRegion, createMapKitTileOverlay, crossfadeMapKitOverlayOpacity, } from './runtime.js';
const TRANSPARENT_PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
const DEFAULT_REGION_PADDING = 0.05;
const DEFAULT_REGION_MIN_SPAN_DELTA = 0.01;
const DEFAULT_REPLACE_CROSSFADE_DURATION_MS = 400;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function normalizeLongitudeDegrees(lng) {
    const normalized = ((((lng + 180) % 360) + 360) % 360) - 180;
    return Object.is(normalized, -0) ? 0 : normalized;
}
function normalizeLongitudeForRange(lng) {
    const normalized = normalizeLongitudeDegrees(lng);
    return normalized === -180 && lng > 0 ? 180 : normalized;
}
function tileYToLatitude(y, tileCount) {
    const mercator = Math.PI * (1 - (2 * y) / tileCount);
    return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI;
}
function tileLngLatBounds(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
        return null;
    const tileCount = 2 ** z;
    if (!Number.isFinite(tileCount) || tileCount <= 0)
        return null;
    const westLng = (x / tileCount) * 360 - 180;
    const eastLng = ((x + 1) / tileCount) * 360 - 180;
    const northLat = tileYToLatitude(y, tileCount);
    const southLat = tileYToLatitude(y + 1, tileCount);
    if (!Number.isFinite(westLng) ||
        !Number.isFinite(eastLng) ||
        !Number.isFinite(northLat) ||
        !Number.isFinite(southLat)) {
        return null;
    }
    return {
        eastLng,
        northLat,
        southLat,
        westLng,
    };
}
function longitudeRanges(bounds) {
    const [westLng, , eastLng] = bounds;
    const rawLngDelta = eastLng - westLng;
    if (!Number.isFinite(rawLngDelta) || Math.abs(rawLngDelta) >= 360)
        return [[-180, 180]];
    const west = normalizeLongitudeForRange(westLng);
    const east = normalizeLongitudeForRange(eastLng);
    return rawLngDelta >= 0 ? [[west, east]] : [[west, 180], [-180, east]];
}
function rangesIntersect(first, second) {
    return first[0] <= second[1] && first[1] >= second[0];
}
function boundsIntersectTile(bounds, tile) {
    const [, southLat, , northLat] = bounds;
    const south = clamp(Math.min(southLat, northLat), -90, 90);
    const north = clamp(Math.max(southLat, northLat), -90, 90);
    if (!Number.isFinite(south) || !Number.isFinite(north))
        return false;
    if (south > tile.northLat || north < tile.southLat)
        return false;
    const tileLngRange = [clamp(tile.westLng, -180, 180), clamp(tile.eastLng, -180, 180)];
    return longitudeRanges(bounds).some((range) => rangesIntersect(range, tileLngRange));
}
function formatUrlTemplate(urlTemplate, x, y, scale, z) {
    return urlTemplate
        .replaceAll('{x}', String(x))
        .replaceAll('{y}', String(y))
        .replaceAll('{z}', String(z))
        .replaceAll('{scale}', String(scale));
}
function rawBoundsSpan(bounds) {
    const [westLng, southLat, eastLng, northLat] = bounds;
    const rawLngDelta = eastLng - westLng;
    const lngSpan = Math.abs(rawLngDelta) >= 360 ? 360 : rawLngDelta >= 0 ? rawLngDelta : rawLngDelta + 360;
    return Math.max(Math.abs(northLat - southLat), lngSpan);
}
function resolveLayerRegionOptions(bounds, options = {}) {
    const resolved = { ...options };
    if (!('padding' in resolved))
        resolved.padding = DEFAULT_REGION_PADDING;
    if (!('minSpanDelta' in resolved)) {
        resolved.minSpanDelta = Math.min(DEFAULT_REGION_MIN_SPAN_DELTA, rawBoundsSpan(bounds) * 0.1);
    }
    return resolved;
}
function overlayOptionsForDescriptor(descriptor, opacity) {
    const options = { opacity };
    if (descriptor.minimumZ !== undefined)
        options.minimumZ = descriptor.minimumZ;
    if (descriptor.maximumZ !== undefined)
        options.maximumZ = descriptor.maximumZ;
    if (descriptor.data !== undefined)
        options.data = descriptor.data;
    return options;
}
function requireLayerId(id) {
    if (!id.trim())
        throw new Error('layer id is required');
}
function uniqueOverlays(overlays) {
    return [...new Set(overlays)];
}
export function createBoundsGatedUrlTemplate(urlTemplate, bounds) {
    if (!bounds)
        return urlTemplate;
    if (!urlTemplate.trim())
        throw new Error('urlTemplate is required');
    return (x, y, scale, z) => {
        const tile = tileLngLatBounds(x, y, z);
        if (!tile || !boundsIntersectTile(bounds, tile))
            return TRANSPARENT_PNG_DATA_URI;
        return formatUrlTemplate(urlTemplate, x, y, scale, z);
    };
}
export function regionForMapKitLayerBounds(mapkit, bounds, options = {}) {
    const region = computeMapKitRegionForLngLatBounds(bounds, resolveLayerRegionOptions(bounds, options));
    if (!region)
        throw new RangeError('layer bounds must contain finite lng/lat values');
    return createMapKitCoordinateRegion(mapkit, region);
}
export function regionForMapKitLayer(mapkit, descriptor, options = {}) {
    if (!descriptor.bounds)
        throw new Error('layer descriptor must include bounds');
    return regionForMapKitLayerBounds(mapkit, descriptor.bounds, options);
}
export class MapKitLayerRegistry {
    #defaultCrossfadeDurationMs;
    #entries = new Map();
    #map;
    #mapkit;
    constructor(options) {
        this.#mapkit = options.mapkit;
        this.#map = options.map;
        this.#defaultCrossfadeDurationMs =
            options.crossfadeDurationMs ?? DEFAULT_REPLACE_CROSSFADE_DURATION_MS;
    }
    register(descriptor) {
        requireLayerId(descriptor.id);
        if (this.#entries.has(descriptor.id)) {
            throw new Error(`layer "${descriptor.id}" is already registered`);
        }
        const overlay = this.#createOverlay(descriptor, descriptor.opacity ?? 1);
        this.#map.addTileOverlay(overlay);
        this.#entries.set(descriptor.id, {
            fading: new Set(),
            overlay,
        });
        return overlay;
    }
    unregister(id) {
        const entry = this.#entries.get(id);
        if (!entry)
            return;
        entry.controller?.cancel();
        for (const overlay of uniqueOverlays([entry.overlay, ...entry.fading])) {
            this.#map.removeTileOverlay(overlay);
        }
        this.#entries.delete(id);
    }
    setOpacity(id, opacity) {
        const entry = this.#entries.get(id);
        if (!entry)
            throw new Error(`layer "${id}" is not registered`);
        entry.overlay.opacity = opacity;
    }
    replace(id, descriptor, options = {}) {
        requireLayerId(id);
        if (descriptor.id !== id)
            throw new Error('replacement descriptor id must match id');
        const entry = this.#entries.get(id);
        if (!entry)
            throw new Error(`layer "${id}" is not registered`);
        entry.controller?.cancel();
        const oldOverlays = uniqueOverlays([entry.overlay, ...entry.fading]);
        for (const overlay of oldOverlays)
            entry.fading.add(overlay);
        const targetOpacity = descriptor.opacity ?? 1;
        const nextOverlay = this.#createOverlay(descriptor, 0);
        this.#map.addTileOverlay(nextOverlay);
        entry.overlay = nextOverlay;
        let controller;
        const crossfadeOptions = {
            durationMs: options.crossfadeDurationMs ?? this.#defaultCrossfadeDurationMs,
            nextOverlay,
            oldOverlays,
            onDone: () => {
                for (const overlay of oldOverlays)
                    entry.fading.delete(overlay);
                if (entry.controller === controller)
                    delete entry.controller;
            },
            removeOverlay: (overlay) => this.#map.removeTileOverlay(overlay),
            targetOpacity,
        };
        if (options.signal !== undefined)
            crossfadeOptions.signal = options.signal;
        controller = crossfadeMapKitOverlayOpacity(crossfadeOptions);
        entry.controller = controller;
        return controller.finished;
    }
    get(id) {
        return this.#entries.get(id)?.overlay;
    }
    has(id) {
        return this.#entries.has(id);
    }
    list() {
        return [...this.#entries.keys()];
    }
    #createOverlay(descriptor, opacity) {
        const urlTemplate = createBoundsGatedUrlTemplate(descriptor.urlTemplate, descriptor.bounds);
        return createMapKitTileOverlay(this.#mapkit, urlTemplate, overlayOptionsForDescriptor(descriptor, opacity));
    }
}
//# sourceMappingURL=layers.js.map