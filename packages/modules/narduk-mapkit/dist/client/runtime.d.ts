import type { MapKitLngLatBounds, MapKitPointLike, MapKitRegionOptions } from '../geometry/geometry.js';
import type { MapKitRegion, MapKitRegionSpan } from '../types.js';
type Constructor<TArgs extends readonly unknown[], TResult> = new (...args: TArgs) => TResult;
export interface MapKitRegionConstructors<TCoordinate = unknown, TSpan = unknown, TRegion = unknown> {
    Coordinate: Constructor<[latitude: number, longitude: number], TCoordinate>;
    CoordinateRegion: Constructor<[center: TCoordinate, span: TSpan], TRegion>;
    CoordinateSpan: Constructor<[latitudeDelta: number, longitudeDelta: number], TSpan>;
}
export type MapKitTileOverlayUrlTemplate = string | ((x: number, y: number, z: number, scale: number) => string);
export type MapKitTileImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
export type MapKitTileOverlayImageSource<TImageSource = MapKitTileImageSource> = (x: number, y: number, z: number, scale: number, data?: unknown) => Promise<TImageSource | null>;
export type MapKitTileOverlaySource<TImageSource = MapKitTileImageSource> = MapKitTileOverlayUrlTemplate | MapKitTileOverlayImageSource<TImageSource>;
export interface MapKitTileOverlayConstructors<TTileOverlay = unknown, TSource extends MapKitTileOverlaySource<unknown> = MapKitTileOverlaySource> {
    TileOverlay: Constructor<[
        source: TSource,
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
export declare function createMapKitTileOverlay<TTileOverlay, TSource extends MapKitTileOverlaySource<unknown>>(mapkit: MapKitTileOverlayConstructors<TTileOverlay, TSource>, source: TSource, options?: MapKitTileOverlayOptions): TTileOverlay;
export interface MapKitAsyncTileOverlayLifecycle {
    onError?: (reason: unknown) => void;
    onFirstImage?: () => void;
}
/**
 * Construct a MapKit JS 6 Promise<ImageSource> tile overlay and expose the
 * first usable image as a lifecycle event for safe layer replacement.
 */
export declare function createMapKitAsyncTileOverlay<TTileOverlay, TImageSource>(mapkit: MapKitTileOverlayConstructors<TTileOverlay, MapKitTileOverlayImageSource<TImageSource>>, imageForTile: MapKitTileOverlayImageSource<TImageSource>, options?: MapKitTileOverlayOptions, lifecycle?: MapKitAsyncTileOverlayLifecycle): TTileOverlay;
export declare function uniqueMapKitOverlays<TOverlay>(overlays: readonly TOverlay[]): TOverlay[];
export interface MapKitVectorOverlayMap<TOverlay = unknown> {
    overlays?: readonly TOverlay[];
    addOverlay: (overlay: TOverlay) => unknown;
    removeOverlay: (overlay: TOverlay) => void;
}
/** Add a vector overlay once, even when a reactive visibility update repeats. */
export declare function addMapKitVectorOverlay<TOverlay>(map: MapKitVectorOverlayMap<TOverlay>, overlay: TOverlay): void;
/** Remove a vector overlay only when MapKit still has it attached. */
export declare function removeMapKitVectorOverlay<TOverlay>(map: MapKitVectorOverlayMap<TOverlay>, overlay: TOverlay): void;
export declare function easeInOutQuad(progress: number): number;
export declare function interpolateNumber(start: number, end: number, progress: number): number;
export declare function crossfadeMapKitOverlayOpacity<TOverlay extends MapKitOpacityTarget>(options: MapKitOverlayCrossfadeOptions<TOverlay>): MapKitOverlayCrossfadeController;
export {};
//# sourceMappingURL=runtime.d.ts.map