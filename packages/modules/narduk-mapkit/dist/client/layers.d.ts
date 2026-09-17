import type { MapKitLngLatBounds, MapKitRegionOptions } from '../geometry/geometry.js';
import type { MapKitOpacityTarget, MapKitTileImageSource, MapKitTileOverlayImageSource, MapKitTileOverlaySource, MapKitRegionConstructors, MapKitTileOverlayConstructors, MapKitTileOverlayUrlTemplate } from './runtime.js';
interface MapKitLayerDescriptorBase<TData = unknown> {
    bounds?: MapKitLngLatBounds;
    data?: TData;
    id: string;
    maximumZ?: number;
    minimumZ?: number;
    opacity?: number;
    /**
     * Draw order among the registry's own overlays: lower draws first, i.e.
     * underneath. Ties break on registration order. Omitted, a layer sorts by the
     * order it was registered, which is what `addTileOverlay` alone produced
     * before narduk-libs#402.
     *
     * `reconcile()` overrides this with array position unless a descriptor
     * carries an explicit `order`.
     */
    order?: number;
}
export interface MapKitUrlLayerDescriptor<TData = unknown> extends MapKitLayerDescriptorBase<TData> {
    urlTemplate: string;
}
export interface MapKitAsyncLayerDescriptor<TData = unknown, TImageSource = MapKitTileImageSource> extends MapKitLayerDescriptorBase<TData> {
    imageForTile: MapKitTileOverlayImageSource<TImageSource>;
    onTileError?: (reason: unknown) => void;
}
export type MapKitLayerDescriptor<TData = unknown, TImageSource = MapKitTileImageSource> = MapKitUrlLayerDescriptor<TData> | MapKitAsyncLayerDescriptor<TData, TImageSource>;
export interface MapKitLayerRegionOptions extends MapKitRegionOptions {
}
export interface MapKitLayerMapHandle<TTileOverlay> {
    addTileOverlay(overlay: TTileOverlay): void;
    removeTileOverlay(overlay: TTileOverlay): void;
    /**
     * MapKit's own overlay list. Optional because a 2.0.x-era handle (and the
     * gonogo case: a v5 map driven through 2.1.0 controllers) supplies only the
     * two methods above. Present and array-valued, the registry re-asserts draw
     * order through it after every attach and detach; absent, `null`, or not an
     * array, ordering silently degrades to attach order rather than throwing.
     */
    tileOverlays?: TTileOverlay[] | null;
}
export interface MapKitLayerRegistryOptions<TTileOverlay> {
    cancelAnimationFrame?: (handle: number) => void;
    crossfadeDurationMs?: number;
    map: MapKitLayerMapHandle<TTileOverlay>;
    mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlaySource<unknown>>;
    /** Crossfade clock. Injected together with `requestAnimationFrame` under test. */
    now?: () => number;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}
export interface MapKitLayerReplaceOptions {
    activateWhen?: 'immediate' | 'first-image';
    crossfadeDurationMs?: number;
    readinessTimeoutMs?: number;
    signal?: AbortSignal;
}
export interface MapKitLayerReconcileOptions {
    /** Crossfade duration for source changes. Use `0` for atomic Safari-safe swaps. */
    crossfadeDurationMs?: number;
    signal?: AbortSignal;
}
/**
 * Stable identity for the tile source of a layer descriptor, excluding opacity.
 * Used by `MapKitLayerRegistry.reconcile()` to decide setOpacity vs replace.
 */
export declare function layerSourceIdentity(descriptor: MapKitLayerDescriptor): string;
export declare function createBoundsGatedUrlTemplate(urlTemplate: string, bounds: MapKitLngLatBounds | undefined): MapKitTileOverlayUrlTemplate;
export declare function regionForMapKitLayerBounds<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, bounds: MapKitLngLatBounds, options?: MapKitLayerRegionOptions): TRegion;
export declare function regionForMapKitLayer<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, descriptor: MapKitLayerDescriptor, options?: MapKitLayerRegionOptions): TRegion;
export declare class MapKitLayerRegistry<TTileOverlay extends MapKitOpacityTarget> {
    #private;
    constructor(options: MapKitLayerRegistryOptions<TTileOverlay>);
    register(descriptor: MapKitLayerDescriptor): TTileOverlay;
    unregister(id: string): void;
    /**
     * The registry's own overlays in draw order: lowest `order` first, ties on
     * registration sequence, and within one layer every retiring overlay sits
     * directly beneath the incoming one so a crossfade reveals the new tiles
     * rather than the layer above (narduk-libs#402).
     */
    overlays(): readonly TTileOverlay[];
    setOpacity(id: string, opacity: number): void;
    replace(id: string, descriptor: MapKitLayerDescriptor, options?: MapKitLayerReplaceOptions): Promise<void>;
    get(id: string): TTileOverlay | undefined;
    has(id: string): boolean;
    list(): readonly string[];
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
    reconcile(descriptors: readonly MapKitLayerDescriptor[], options?: MapKitLayerReconcileOptions): Promise<void>;
}
export {};
//# sourceMappingURL=layers.d.ts.map