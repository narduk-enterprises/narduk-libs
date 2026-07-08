import type { MapKitLngLatBounds, MapKitPointLike, MapKitRegionOptions } from '../geometry/geometry.js';
import type { MapKitRegion, MapKitRegionSpan } from '../types.js';
type Constructor<TArgs extends readonly unknown[], TResult> = new (...args: TArgs) => TResult;
export interface MapKitRegionConstructors<TCoordinate = unknown, TSpan = unknown, TRegion = unknown> {
    Coordinate: Constructor<[latitude: number, longitude: number], TCoordinate>;
    CoordinateRegion: Constructor<[center: TCoordinate, span: TSpan], TRegion>;
    CoordinateSpan: Constructor<[latitudeDelta: number, longitudeDelta: number], TSpan>;
}
export type MapKitTileOverlayUrlTemplate = string | ((x: number, y: number, scale: number, z: number) => string);
export interface MapKitTileOverlayConstructors<TTileOverlay = unknown, TUrlTemplate extends MapKitTileOverlayUrlTemplate = MapKitTileOverlayUrlTemplate> {
    TileOverlay: Constructor<[
        urlTemplate: TUrlTemplate,
        options?: MapKitTileOverlayOptions
    ], TTileOverlay>;
}
export interface MapKitTileOverlayOptions {
    data?: unknown;
    maximumZ?: number;
    minimumZ?: number;
    opacity?: number;
    [key: string]: unknown;
}
export interface MapKitOpacityTarget {
    opacity: number;
}
export interface MapKitOverlayCrossfadeOptions<TOverlay extends MapKitOpacityTarget> {
    cancelAnimationFrame?: (handle: number) => void;
    durationMs?: number;
    easing?: (progress: number) => number;
    nextOverlay: TOverlay;
    now?: () => number;
    oldOverlays: readonly TOverlay[];
    onDone?: () => void;
    removeOverlay?: (overlay: TOverlay) => void;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    signal?: AbortSignal;
    targetOpacity: number;
}
export interface MapKitOverlayCrossfadeController {
    cancel: () => void;
    finished: Promise<void>;
}
export declare function createMapKitCoordinate<TCoordinate>(mapkit: Pick<MapKitRegionConstructors<TCoordinate>, 'Coordinate'>, point: MapKitPointLike): TCoordinate;
export declare function createMapKitCoordinateSpan<TSpan>(mapkit: Pick<MapKitRegionConstructors<unknown, TSpan>, 'CoordinateSpan'>, span: MapKitRegionSpan): TSpan;
export declare function createMapKitCoordinateRegion<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, region: MapKitRegion): TRegion;
export declare function createMapKitRegionForPoints<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, points: readonly MapKitPointLike[] | null | undefined, options?: MapKitRegionOptions): TRegion | null;
export declare function createMapKitRegionForLngLatBounds<TCoordinate, TSpan, TRegion>(mapkit: MapKitRegionConstructors<TCoordinate, TSpan, TRegion>, bounds: MapKitLngLatBounds | null | undefined, options?: MapKitRegionOptions): TRegion | null;
export declare function createMapKitTileOverlay<TTileOverlay, TUrlTemplate extends MapKitTileOverlayUrlTemplate>(mapkit: MapKitTileOverlayConstructors<TTileOverlay, TUrlTemplate>, urlTemplate: TUrlTemplate, options?: MapKitTileOverlayOptions): TTileOverlay;
export declare function uniqueMapKitOverlays<TOverlay>(overlays: readonly TOverlay[]): TOverlay[];
export declare function easeInOutQuad(progress: number): number;
export declare function interpolateNumber(start: number, end: number, progress: number): number;
export declare function crossfadeMapKitOverlayOpacity<TOverlay extends MapKitOpacityTarget>(options: MapKitOverlayCrossfadeOptions<TOverlay>): MapKitOverlayCrossfadeController;
export {};
//# sourceMappingURL=runtime.d.ts.map