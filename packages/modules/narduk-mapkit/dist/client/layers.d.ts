import type { MapKitLngLatBounds, MapKitRegionOptions } from '../geometry/geometry.js';
import type { MapKitOpacityTarget, MapKitRegionConstructors, MapKitTileOverlayConstructors, MapKitTileOverlayUrlTemplate } from './runtime.js';
export interface MapKitLayerDescriptor<TData = unknown> {
    bounds?: MapKitLngLatBounds;
    data?: TData;
    id: string;
    maximumZ?: number;
    minimumZ?: number;
    opacity?: number;
    urlTemplate: string;
}
export interface MapKitLayerRegionOptions extends MapKitRegionOptions {
}
export interface MapKitLayerMapHandle<TTileOverlay> {
    addTileOverlay(overlay: TTileOverlay): void;
    removeTileOverlay(overlay: TTileOverlay): void;
}
export interface MapKitLayerRegistryOptions<TTileOverlay> {
    crossfadeDurationMs?: number;
    map: MapKitLayerMapHandle<TTileOverlay>;
    mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlayUrlTemplate>;
}
export declare function createBoundsGatedUrlTemplate(urlTemplate: string, bounds: MapKitLngLatBounds | undefined): MapKitTileOverlayUrlTemplate;
export declare function regionForMapKitLayerBounds<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, bounds: MapKitLngLatBounds, options?: MapKitLayerRegionOptions): TRegion;
export declare function regionForMapKitLayer<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, descriptor: MapKitLayerDescriptor, options?: MapKitLayerRegionOptions): TRegion;
export declare class MapKitLayerRegistry<TTileOverlay extends MapKitOpacityTarget> {
    #private;
    constructor(options: MapKitLayerRegistryOptions<TTileOverlay>);
    register(descriptor: MapKitLayerDescriptor): TTileOverlay;
    unregister(id: string): void;
    setOpacity(id: string, opacity: number): void;
    replace(id: string, descriptor: MapKitLayerDescriptor, options?: {
        crossfadeDurationMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    get(id: string): TTileOverlay | undefined;
    has(id: string): boolean;
    list(): readonly string[];
}
//# sourceMappingURL=layers.d.ts.map