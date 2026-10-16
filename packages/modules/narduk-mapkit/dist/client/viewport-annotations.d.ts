import type { LatLng } from '../geometry/helpers.js';
import type { MapKitVisibleRegion } from '../geometry/declutter.js';
import type { MapKitAnnotationMapHandle, MapKitAnnotationReconcileResult } from './annotations.js';
export interface MapKitViewportAnnotationsOptions<TItem extends LatLng, TAnnotation> {
    /** Build the annotation for an item. Called once per item that enters. */
    create: (item: TItem) => TAnnotation;
    /**
     * Fraction of the region's size beyond each edge at which an item is added.
     * Default 0.25. Must not exceed `keepPadding`.
     */
    enterPadding?: number;
    /** Stable identity of an item. */
    key: (item: TItem) => string;
    /**
     * Fraction of the region's size beyond each edge at which an item already on
     * the map is removed. Default 0.6.
     */
    keepPadding?: number;
    map: MapKitAnnotationMapHandle<TAnnotation>;
    /** Keys that stay on the map wherever the region is. */
    pinned?: () => Iterable<string>;
    /** Everything that changes how an item looks. Without it, an item is built once. */
    signature?: (item: TItem) => string;
    /** Apply a changed signature in place instead of rebuilding that annotation. */
    update?: (annotation: TAnnotation, item: TItem) => void;
}
export declare class MapKitViewportAnnotations<TItem extends LatLng, TAnnotation> {
    #private;
    constructor(options: MapKitViewportAnnotationsOptions<TItem, TAnnotation>);
    /** Annotations on the map now. */
    get size(): number;
    has(key: string): boolean;
    get(key: string): TAnnotation | undefined;
    keys(): readonly string[];
    /**
     * Make the map hold the items near `region`. Pass `null` for a region not yet
     * known: every item is held back, because adding thousands before the first
     * region report is the stall this exists to avoid.
     */
    sync(items: readonly TItem[], region: MapKitVisibleRegion | null): MapKitAnnotationReconcileResult;
    /** Remove everything and refuse further syncs. */
    destroy(): void;
}
//# sourceMappingURL=viewport-annotations.d.ts.map