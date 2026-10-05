import type { VectorTileCoordinate, VectorTileHit } from './hit-test.js';
import type { LabelCanvas, LabelHit, LabelLayer } from './label-layer.js';
import type { PointLayer, PointLayerCanvas } from './point-layer.js';
import type { VectorTileCanvas, VectorTileOverlaySource } from './vector-tiles.js';
/** The device a pointer event came from, as `PointerEvent.pointerType` reports it. */
export type HitPointerKind = 'mouse' | 'pen' | 'touch';
/** What every layer is asked: where, at what zoom, and how close counts as a hit. */
export interface HitProbe {
    coordinate: VectorTileCoordinate;
    pointer: HitPointerKind;
    /** Screen radius in CSS pixels, already resolved for the pointer kind. */
    tolerancePx: number;
    /** The zoom the map is displaying. */
    zoom: number;
}
/** A caller-supplied area tester. Return `null` (or `undefined`) for no area. */
export type AreaHitTester<TArea> = (probe: HitProbe) => TArea | null | undefined;
/**
 * One hit-testable layer, in the order the caller wants it asked. `point` is a
 * canvas point layer, `line` a vector-tile overlay source, `area` a tester the
 * caller owns; the overlay source's `hitTestArea` answers one for the areas it
 * paints (`(probe) => source.hitTestArea(probe.coordinate)`).
 */
export type HitLayer<TArea = unknown> = {
    kind: 'area';
    test: AreaHitTester<TArea>;
} | {
    kind: 'line';
    source: Pick<VectorTileOverlaySource<VectorTileCanvas>, 'hitTest'>;
} | {
    kind: 'point';
    layer: Pick<PointLayer<PointLayerCanvas>, 'nearestPoint'>;
};
/**
 * A label layer as a hit layer. Kept apart from {@link HitLayer} so the types
 * a caller already switches on do not gain a member: pass `LabelHitLayer`
 * entries and the result type widens to {@link ResolvedHitWithLabel}.
 */
export interface LabelHitLayer {
    kind: 'label';
    layer: Pick<LabelLayer<LabelCanvas>, 'labelAt'>;
}
/** The one answer, carrying the answering layer's own hit. */
export type ResolvedHit<TArea = unknown> = {
    hit: number;
    kind: 'point';
} | {
    hit: TArea;
    kind: 'area';
} | {
    hit: VectorTileHit;
    kind: 'line';
};
/** A label's hit is its anchor's index, id (when it has one) and text. */
export type ResolvedHitWithLabel<TArea = unknown> = ResolvedHit<TArea> | {
    hit: LabelHit;
    kind: 'label';
};
export interface ResolveHitOptions<TArea = unknown, TLayer = HitLayer<TArea>> {
    coordinate: VectorTileCoordinate;
    /** Layers in priority order; the first to report a hit wins. */
    layers: readonly TLayer[];
    /** Default `'mouse'`. A pen is as precise as a mouse and gets its tolerance. */
    pointer?: HitPointerKind;
    /** Override the mouse (and pen) tolerance. Default {@link DEFAULT_MOUSE_HIT_TOLERANCE_PX}. */
    mouseTolerancePx?: number;
    /** Override the touch tolerance. Default {@link DEFAULT_TOUCH_HIT_TOLERANCE_PX}. */
    touchTolerancePx?: number;
    /** The zoom the map is displaying. */
    zoom: number;
}
/** The screen radius, in CSS pixels, a pointer kind gets under the given overrides. */
export declare function hitTolerancePx(pointer: HitPointerKind, overrides?: {
    mouseTolerancePx?: number;
    touchTolerancePx?: number;
}): number;
/**
 * Ask the layers in order and return the first hit, or `null`.
 *
 * A point layer's hit is the index of the dot; a line layer's is the overlay's
 * {@link VectorTileHit}; an area's is whatever the tester returned. A layer
 * that reports nothing is a miss and the next is asked; after a hit no later
 * layer is asked.
 */
export declare function resolveHit<TArea = unknown>(options: ResolveHitOptions<TArea>): ResolvedHit<TArea> | null;
/** With a {@link LabelHitLayer} in `layers`; a label hit is typed `label`. */
export declare function resolveHit<TArea = unknown>(options: ResolveHitOptions<TArea, HitLayer<TArea> | LabelHitLayer>): ResolvedHitWithLabel<TArea> | null;
//# sourceMappingURL=resolve-hit.d.ts.map