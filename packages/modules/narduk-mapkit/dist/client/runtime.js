import { computeMapKitRegionForLngLatBounds, computeMapKitRegionForPoints, normalizeMapKitPoint, normalizeMapKitSpan, } from '../geometry/geometry.js';
import { defaultMapKitFrameScheduler } from './timers.js';
function requireMapKitPoint(point) {
    const normalized = normalizeMapKitPoint(point);
    if (!normalized)
        throw new RangeError('point must contain finite lat and lng values');
    return normalized;
}
function requireMapKitSpan(span) {
    const normalized = normalizeMapKitSpan(span);
    if (!normalized) {
        throw new RangeError('span must contain finite latDelta and lngDelta values');
    }
    return normalized;
}
function requireMapKitRegion(region) {
    if (!region)
        throw new RangeError('region is required');
    const center = requireMapKitPoint(region.center);
    const span = requireMapKitSpan(region.span);
    return { center, span };
}
export function createMapKitCoordinate(mapkit, point) {
    const normalized = requireMapKitPoint(point);
    return new mapkit.Coordinate(normalized.lat, normalized.lng);
}
export function createMapKitCoordinateSpan(mapkit, span) {
    const normalized = requireMapKitSpan(span);
    return new mapkit.CoordinateSpan(normalized.latDelta, normalized.lngDelta);
}
export function createMapKitCoordinateRegion(mapkit, region) {
    const normalized = requireMapKitRegion(region);
    const center = createMapKitCoordinate(mapkit, normalized.center);
    const span = createMapKitCoordinateSpan(mapkit, normalized.span);
    return new mapkit.CoordinateRegion(center, span);
}
export function createMapKitRegionForPoints(mapkit, points, options = {}) {
    const region = computeMapKitRegionForPoints(points, options);
    return region ? createMapKitCoordinateRegion(mapkit, region) : null;
}
export function createMapKitRegionForLngLatBounds(mapkit, bounds, options = {}) {
    const region = computeMapKitRegionForLngLatBounds(bounds, options);
    return region ? createMapKitCoordinateRegion(mapkit, region) : null;
}
export function createMapKitTileOverlay(mapkit, source, options = {}) {
    if (typeof source === 'string' && !source.trim())
        throw new Error('tile overlay source is required');
    if (typeof source !== 'string' && typeof source !== 'function') {
        throw new Error('tile overlay source is required');
    }
    return new mapkit.TileOverlay(source, options);
}
/**
 * Construct a MapKit JS 6 Promise<ImageSource> tile overlay and expose the
 * first usable image as a lifecycle event for safe layer replacement.
 */
export function createMapKitAsyncTileOverlay(mapkit, imageForTile, options = {}, lifecycle = {}) {
    let hasImage = false;
    const source = (x, y, z, scale, data) => {
        try {
            return imageForTile(x, y, z, scale, data)
                .then((image) => {
                if (image !== null && !hasImage) {
                    hasImage = true;
                    lifecycle.onFirstImage?.();
                }
                return image;
            })
                .catch((reason) => {
                lifecycle.onError?.(reason);
                return null;
            });
        }
        catch (reason) {
            lifecycle.onError?.(reason);
            return Promise.resolve(null);
        }
    };
    return createMapKitTileOverlay(mapkit, source, options);
}
export function uniqueMapKitOverlays(overlays) {
    return [...new Set(overlays)];
}
const attachedVectorOverlays = new WeakMap();
function attachedVectorOverlaySet(map) {
    let overlays = attachedVectorOverlays.get(map);
    if (!overlays) {
        overlays = new Set();
        attachedVectorOverlays.set(map, overlays);
    }
    return overlays;
}
/** Add a vector overlay once, even when a reactive visibility update repeats. */
export function addMapKitVectorOverlay(map, overlay) {
    const attached = attachedVectorOverlaySet(map);
    if (attached.has(overlay))
        return;
    if (!map.overlays?.includes(overlay))
        map.addOverlay(overlay);
    attached.add(overlay);
}
/** Remove a vector overlay only when MapKit still has it attached. */
export function removeMapKitVectorOverlay(map, overlay) {
    const attached = attachedVectorOverlaySet(map);
    const present = attached.has(overlay) || Boolean(map.overlays?.includes(overlay));
    if (!present)
        return;
    map.removeOverlay(overlay);
    attached.delete(overlay);
}
export function easeInOutQuad(progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}
export function interpolateNumber(start, end, progress) {
    return start + (end - start) * progress;
}
function finiteOpacity(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/**
 * The single clock the crossfade reads.
 *
 * `requestAnimationFrame` hands its callback a `performance.now()` timestamp,
 * whose epoch is page load -- not `Date.now()`'s Unix epoch. Measuring
 * `frameTimestamp - Date.now()` therefore produced a large negative number that
 * `Math.max(0, ...)` clamped to `0` on every frame, so progress never advanced
 * and the fade never completed in a real browser. The fix is to read elapsed
 * time from ONE clock: `now()` for both the start stamp and every frame, and to
 * ignore the frame timestamp entirely (narduk-libs#421, spec §d).
 */
function defaultCrossfadeNow() {
    const performanceNow = globalThis.performance?.now;
    return performanceNow ? performanceNow.call(globalThis.performance) : Date.now();
}
export function crossfadeMapKitOverlayOpacity(options) {
    const durationMs = Math.max(0, options.durationMs ?? 520);
    const oldOverlays = uniqueMapKitOverlays(options.oldOverlays);
    const oldStartOpacities = oldOverlays.map((overlay) => finiteOpacity(overlay.opacity, options.targetOpacity));
    const nextStartOpacity = finiteOpacity(options.nextOverlay.opacity, 0);
    const easing = options.easing ?? easeInOutQuad;
    const now = options.now ?? defaultCrossfadeNow;
    const requestFrame = options.requestAnimationFrame ?? defaultMapKitFrameScheduler.requestAnimationFrame;
    const cancelFrame = options.cancelAnimationFrame ?? defaultMapKitFrameScheduler.cancelAnimationFrame;
    const start = now();
    let frameHandle = null;
    let settled = false;
    let resolveFinished = () => { };
    const finished = new Promise((resolve) => {
        resolveFinished = resolve;
    });
    function finish(complete) {
        if (settled)
            return;
        settled = true;
        if (complete) {
            options.nextOverlay.opacity = options.targetOpacity;
            for (const overlay of oldOverlays) {
                options.removeOverlay?.(overlay);
            }
            options.onDone?.();
        }
        resolveFinished();
    }
    function step() {
        if (settled)
            return;
        if (options.signal?.aborted) {
            finish(false);
            return;
        }
        // The frame timestamp is deliberately unread: it belongs to a different
        // epoch than `now()`. See `defaultCrossfadeNow`.
        const elapsed = Math.max(0, now() - start);
        const progress = durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs);
        const eased = easing(progress);
        options.nextOverlay.opacity = interpolateNumber(nextStartOpacity, options.targetOpacity, eased);
        // Rewriting this to `for…of` over `.entries()` is a control-flow change in
        // a per-frame animation path, and differs on sparse arrays.
        // eslint-disable-next-line unicorn/no-for-each -- narduk-libs#138
        oldOverlays.forEach((overlay, index) => {
            overlay.opacity = oldStartOpacities[index] * (1 - eased);
        });
        if (progress >= 1) {
            finish(true);
            return;
        }
        frameHandle = requestFrame(step);
    }
    frameHandle = requestFrame(step);
    return {
        cancel: () => {
            if (frameHandle !== null)
                cancelFrame(frameHandle);
            finish(false);
        },
        finished,
    };
}
//# sourceMappingURL=runtime.js.map