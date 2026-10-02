/**
 * One tap, one answer.
 *
 * On the national map a touch can land on a gauge dot, a river line and an
 * alert area at once, and the visitor gets one card: a dot wins over a line, a
 * line over an area. Each layer can already say what is under a point; this
 * asks them in the caller's priority order and returns the first answer, typed
 * by kind, so an app never has to query the point layer and the vector-tile
 * overlay separately and reconcile them.
 *
 * Every layer is asked synchronously, from what it already holds. Nothing here
 * awaits a read, and a layer that is not reached is not asked at all.
 */
import { DEFAULT_MOUSE_HIT_TOLERANCE_PX, DEFAULT_TOUCH_HIT_TOLERANCE_PX } from './hit-test.js';
/** The screen radius, in CSS pixels, a pointer kind gets under the given overrides. */
export function hitTolerancePx(pointer, overrides = {}) {
    const value = pointer === 'touch'
        ? (overrides.touchTolerancePx ?? DEFAULT_TOUCH_HIT_TOLERANCE_PX)
        : (overrides.mouseTolerancePx ?? DEFAULT_MOUSE_HIT_TOLERANCE_PX);
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('hit tolerance must be a finite number >= 0');
    }
    return value;
}
export function resolveHit(options) {
    const pointer = options.pointer ?? 'mouse';
    const tolerancePx = hitTolerancePx(pointer, options);
    const { coordinate, zoom } = options;
    const probe = { coordinate, pointer, tolerancePx, zoom };
    for (const layer of options.layers) {
        if (layer.kind === 'point') {
            const index = layer.layer.nearestPoint(coordinate, tolerancePx, zoom);
            if (index !== null)
                return { hit: index, kind: 'point' };
        }
        else if (layer.kind === 'label') {
            const hit = layer.layer.labelAt(coordinate, tolerancePx, zoom);
            if (hit)
                return { hit, kind: 'label' };
        }
        else if (layer.kind === 'line') {
            const hit = layer.source.hitTest({ coordinate, tolerancePx, zoom });
            if (hit)
                return { hit, kind: 'line' };
        }
        else {
            const hit = layer.test(probe);
            if (hit !== null && hit !== undefined)
                return { hit, kind: 'area' };
        }
    }
    return null;
}
//# sourceMappingURL=resolve-hit.js.map