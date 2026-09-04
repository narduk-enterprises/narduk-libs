import { computeMapKitRegionForLngLatBounds } from '../geometry/geometry.js';
import { createMapKitCoordinateRegion, createMapKitAsyncTileOverlay, createMapKitTileOverlay, crossfadeMapKitOverlayOpacity, } from './runtime.js';
const TRANSPARENT_PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
const DEFAULT_REGION_PADDING = 0.05;
const DEFAULT_REGION_MIN_SPAN_DELTA = 0.01;
const DEFAULT_REPLACE_CROSSFADE_DURATION_MS = 400;
/**
 * Stable identity for the tile source of a layer descriptor, excluding opacity.
 * Used by `MapKitLayerRegistry.reconcile()` to decide setOpacity vs replace.
 */
export function layerSourceIdentity(descriptor) {
    if ('imageForTile' in descriptor) {
        return [
            'async',
            descriptor.id,
            JSON.stringify(descriptor.data ?? null),
            String(descriptor.minimumZ ?? ''),
            String(descriptor.maximumZ ?? ''),
        ].join('|');
    }
    return [
        'url',
        descriptor.id,
        descriptor.urlTemplate,
        JSON.stringify(descriptor.bounds ?? null),
        String(descriptor.minimumZ ?? ''),
        String(descriptor.maximumZ ?? ''),
        JSON.stringify(descriptor.data ?? null),
    ].join('|');
}
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
function boundsIntersectTile(bounds, tile, ranges) {
    const [, southLat, , northLat] = bounds;
    const south = clamp(Math.min(southLat, northLat), -90, 90);
    const north = clamp(Math.max(southLat, northLat), -90, 90);
    if (!Number.isFinite(south) || !Number.isFinite(north))
        return false;
    if (south > tile.northLat || north < tile.southLat)
        return false;
    const tileLngRange = [clamp(tile.westLng, -180, 180), clamp(tile.eastLng, -180, 180)];
    return ranges.some((range) => rangesIntersect(range, tileLngRange));
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
    const ranges = longitudeRanges(bounds);
    const decisionCache = new Map();
    const maxDecisionCacheEntries = 2048;
    return (x, y, z, scale) => {
        // Scale changes the URL but not geographic intersection. MapKit commonly
        // asks for the same tile at 1x and 2x, so cache only the geometry decision.
        const cacheKey = `${z}/${x}/${y}`;
        const cached = decisionCache.get(cacheKey);
        if (cached !== undefined) {
            return cached ? formatUrlTemplate(urlTemplate, x, y, scale, z) : TRANSPARENT_PNG_DATA_URI;
        }
        const tile = tileLngLatBounds(x, y, z);
        const intersects = Boolean(tile && boundsIntersectTile(bounds, tile, ranges));
        if (decisionCache.size >= maxDecisionCacheEntries) {
            const oldestKey = decisionCache.keys().next().value;
            if (oldestKey)
                decisionCache.delete(oldestKey);
        }
        decisionCache.set(cacheKey, intersects);
        if (!intersects)
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
            descriptor,
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
        entry.pending?.cancel();
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
        entry.pending?.cancel();
        const oldOverlays = uniqueOverlays([entry.overlay, ...entry.fading]);
        for (const overlay of oldOverlays)
            entry.fading.add(overlay);
        const targetOpacity = descriptor.opacity ?? 1;
        const crossfadeDurationMs = options.crossfadeDurationMs ?? this.#defaultCrossfadeDurationMs;
        // MapKit JS does not consistently repaint a TileOverlay after mutating its
        // opacity in Safari. For an atomic replacement, construct the incoming
        // overlay at its final opacity and use readiness only to decide when the
        // previous overlay can be retired.
        const replaceAtomically = crossfadeDurationMs === 0;
        let markReady = () => { };
        const ready = new Promise((resolve) => { markReady = resolve; });
        const nextOverlay = this.#createOverlay(descriptor, replaceAtomically ? targetOpacity : 0, markReady);
        this.#map.addTileOverlay(nextOverlay);
        entry.overlay = nextOverlay;
        entry.descriptor = descriptor;
        let cancelPending = () => { };
        const cancelled = new Promise((resolve) => {
            cancelPending = () => resolve('cancel');
        });
        entry.pending = { cancel: cancelPending };
        const activate = async () => {
            if (options.activateWhen === 'first-image' && 'imageForTile' in descriptor) {
                const timeoutMs = Math.max(0, options.readinessTimeoutMs ?? 1500);
                const timeout = new Promise((resolve) => {
                    globalThis.setTimeout(() => resolve('timeout'), timeoutMs);
                });
                const signal = options.signal;
                const aborted = new Promise((resolve) => {
                    if (signal?.aborted)
                        resolve('abort');
                    else
                        signal?.addEventListener('abort', () => resolve('abort'), { once: true });
                });
                const outcome = await Promise.race([
                    ready.then(() => 'ready'),
                    timeout,
                    cancelled,
                    aborted,
                ]);
                if (outcome === 'cancel' || outcome === 'abort')
                    return;
            }
            if (entry.overlay !== nextOverlay)
                return;
            if (entry.pending?.cancel === cancelPending)
                delete entry.pending;
            if (replaceAtomically) {
                for (const overlay of oldOverlays) {
                    this.#map.removeTileOverlay(overlay);
                    entry.fading.delete(overlay);
                }
                return;
            }
            let controller;
            const crossfadeOptions = {
                durationMs: crossfadeDurationMs,
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
            await controller.finished;
        };
        return activate();
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
    /**
     * Sync the registry to exactly `descriptors` (order preserved for listing only).
     *
     * Designed for multi-dataset stacks where several tile overlays share a map
     * with independent opacity and may change dated URL templates over time:
     * - new ids → `register`
     * - removed ids → `unregister`
     * - same id + same source identity → `setOpacity` only
     * - same id + changed source → `replace` (atomic when crossfade is 0)
     *
     * Source identity is derived from urlTemplate/bounds/z-range (or `data` for
     * async image overlays), not from opacity.
     */
    async reconcile(descriptors, options = {}) {
        const desiredIds = new Set();
        for (const descriptor of descriptors) {
            requireLayerId(descriptor.id);
            if (desiredIds.has(descriptor.id)) {
                throw new Error(`duplicate layer id "${descriptor.id}" in reconcile()`);
            }
            desiredIds.add(descriptor.id);
        }
        for (const id of [...this.#entries.keys()]) {
            if (!desiredIds.has(id))
                this.unregister(id);
        }
        const crossfadeDurationMs = options.crossfadeDurationMs ?? this.#defaultCrossfadeDurationMs;
        const replacements = [];
        for (const descriptor of descriptors) {
            const entry = this.#entries.get(descriptor.id);
            const opacity = descriptor.opacity ?? 1;
            if (!entry) {
                this.register(descriptor);
                continue;
            }
            const previous = entry.descriptor;
            if (previous && layerSourceIdentity(previous) === layerSourceIdentity(descriptor)) {
                this.setOpacity(descriptor.id, opacity);
                entry.descriptor = descriptor;
                continue;
            }
            replacements.push(this.replace(descriptor.id, descriptor, {
                crossfadeDurationMs,
                ...(options.signal !== undefined ? { signal: options.signal } : {}),
            }).then(() => {
                const current = this.#entries.get(descriptor.id);
                if (current)
                    current.descriptor = descriptor;
            }));
        }
        await Promise.all(replacements);
    }
    #createOverlay(descriptor, opacity, onFirstImage) {
        if ('imageForTile' in descriptor) {
            const lifecycle = {};
            if (descriptor.onTileError)
                lifecycle.onError = descriptor.onTileError;
            if (onFirstImage)
                lifecycle.onFirstImage = onFirstImage;
            return createMapKitAsyncTileOverlay(this.#mapkit, descriptor.imageForTile, overlayOptionsForDescriptor(descriptor, opacity), lifecycle);
        }
        const urlTemplate = createBoundsGatedUrlTemplate(descriptor.urlTemplate, descriptor.bounds);
        return createMapKitTileOverlay(this.#mapkit, urlTemplate, overlayOptionsForDescriptor(descriptor, opacity));
    }
}
//# sourceMappingURL=layers.js.map