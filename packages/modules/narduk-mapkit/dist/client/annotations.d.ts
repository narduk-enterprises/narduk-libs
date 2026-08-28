/**
 * Keyed annotation reconciliation for MapKit JS maps.
 *
 * MapKit JS does no diffing of its own, so the obvious way to update markers
 * is `map.removeAnnotations(all)` followed by `map.addAnnotations(next)`. That
 * destroys and recreates every marker on every render: a consumer map measured
 * on 2026-08-28 rebuilt ~263 annotations on each pan, hover, date change, and
 * opacity tick, and the markers visibly blinked every time.
 *
 * This registry keeps annotations keyed and compares a caller-supplied
 * `signature` per key, so an unchanged marker is never removed, re-added, or
 * mutated -- the host object identity survives untouched across renders.
 *
 * It is the fine-grained sibling of `MapKitLayerRegistry.reconcile()`. That one
 * fingerprints a whole tile source with `layerSourceIdentity()` and treats any
 * change other than opacity as a full replace. Here the consumer owns the
 * comparison: a `signature` is whatever string distinguishes one rendering of a
 * marker from another, so a change can be applied in place through `update()`
 * instead of forcing a recreate.
 */
/** The structural subset of a MapKit map the registry mutates. */
export interface MapKitAnnotationMapHandle<TAnnotation> {
    addAnnotations(annotations: readonly TAnnotation[]): void;
    removeAnnotations(annotations: readonly TAnnotation[]): void;
}
export interface MapKitAnnotationDescriptor<TAnnotation> {
    /**
     * Build the host annotation. Called only when the key is new, or when the
     * signature changed and no `update` hook was supplied.
     */
    create: () => TAnnotation;
    /** Stable identity across renders. Must be non-blank and unique per reconcile. */
    key: string;
    /**
     * Everything that would change how the marker looks or reads -- coordinate,
     * label, glyph, selection, colour. Equal signatures mean "leave it alone",
     * so anything omitted here will not repaint.
     */
    signature: string;
    /**
     * Apply a changed signature to the existing annotation in place. Supplying
     * this is what keeps a moved or relabelled marker from blinking; without it
     * a changed signature recreates that one annotation.
     */
    update?: (annotation: TAnnotation) => void;
}
/**
 * What one `reconcile()` did. `added` and `removed` count the annotations
 * actually handed to the host, so a recreated key appears in both.
 */
export interface MapKitAnnotationReconcileResult {
    added: number;
    /** Changed signature, no `update` hook: that one annotation was rebuilt. */
    recreated: number;
    removed: number;
    /** Same signature: the existing annotation was not touched at all. */
    unchanged: number;
    /** Changed signature applied in place through `update()`. */
    updated: number;
}
export interface MapKitAnnotationRegistryOptions<TAnnotation> {
    map: MapKitAnnotationMapHandle<TAnnotation>;
}
export declare class MapKitAnnotationRegistry<TAnnotation> {
    #private;
    constructor(options: MapKitAnnotationRegistryOptions<TAnnotation>);
    get destroyed(): boolean;
    /** Live annotation count. */
    get size(): number;
    get(key: string): TAnnotation | undefined;
    has(key: string): boolean;
    list(): readonly string[];
    /** Add one annotation outside a reconcile pass. Throws on a duplicate key. */
    register(descriptor: MapKitAnnotationDescriptor<TAnnotation>): TAnnotation;
    /** Remove one annotation. A no-op for unknown keys. */
    unregister(key: string): void;
    /**
     * Sync the map to exactly `descriptors`, in one batched removal and one
     * batched addition:
     *
     * - key present before and after with an unchanged signature -> untouched;
     * - changed signature -> `update()` in place, else recreate that key alone;
     * - key absent now -> removed;
     * - new key -> created.
     *
     * Reconciling the same descriptors twice makes no host call at all, which is
     * what keeps a re-render that changed nothing from repainting the markers.
     */
    reconcile(descriptors: readonly MapKitAnnotationDescriptor<TAnnotation>[]): MapKitAnnotationReconcileResult;
    /** Remove every annotation in one host call. */
    clear(): void;
    /**
     * Clear and make the registry inert. Idempotent. Afterwards `reconcile()`,
     * `unregister()`, and `clear()` do nothing, and `register()` throws because
     * it has no annotation to return.
     */
    destroy(): void;
}
//# sourceMappingURL=annotations.d.ts.map