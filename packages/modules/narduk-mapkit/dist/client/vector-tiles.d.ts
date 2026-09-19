/**
 * Draw vector tiles onto MapKit through the async tile overlay.
 *
 * MapKit JS has no vector tile support: an overlay hands back an image per
 * tile. So this paints each tile to a canvas and returns it, which keeps a
 * dense network (millions of line features) off MapKit's own overlay list.
 *
 * The decode step is injected. That keeps this module free of protobuf
 * dependencies, lets an app run the decoder in a worker, and lets a test paint
 * fixture geometry without building a tile. Decoded tiles are cached, so
 * changing the style repaints from memory and never refetches.
 */
import type { VectorTileCoordinate, VectorTileHit } from './hit-test.js';
/** A decoded feature's properties, as a vector tile carries them. */
export type VectorTileProperties = Record<string, boolean | number | string | null>;
/**
 * A decoded tile, stored columnar rather than as objects.
 *
 * A tile of flowlines carries on the order of 10^5 points. One `{ x, y }`
 * object per point costs roughly 40 bytes once V8 has its header and pointer,
 * so the default 256-tile cache would retain about a gigabyte -- past what
 * mobile Safari gives a tab before it discards it. The same points in an
 * `Int16Array` cost 4 bytes, which is the difference between a cache that
 * survives a pan across the country and one that doesn't.
 *
 * Build one with {@link buildDecodedVectorTile} rather than by hand.
 */
export interface DecodedVectorTile {
    /**
     * Interleaved `x, y` pairs for every line in the tile, in tile-local
     * coordinates. `Int16Array` because a tile's own space is `0..extent` (4096
     * in every tile this library has seen) and a clip buffer adds a fraction of
     * that; see {@link buildDecodedVectorTile} for what happens further out.
     */
    coordinates: Int16Array;
    /** Tile-local coordinate space, 4096 in every tile this library has seen. */
    extent: number;
    /**
     * Where each feature's lines begin, as an index into `lineStarts`. Feature
     * `f` owns lines `featureLines[f]` up to `featureLines[f + 1]`, so the length
     * is one more than the feature count.
     */
    featureLines: Uint32Array;
    /**
     * Where each line begins, as a *point* index into `coordinates`. Line `l`
     * runs from point `lineStarts[l]` up to `lineStarts[l + 1]`, so the length is
     * one more than the line count.
     */
    lineStarts: Uint32Array;
    /** One entry per feature, in the order `featureLines` indexes them. */
    properties: readonly VectorTileProperties[];
}
/** A feature as a caller describes it, before it is packed into flat arrays. */
export interface VectorTileFeatureInput {
    /** One entry per line; each is a run of tile-local points. */
    lines: ReadonlyArray<ReadonlyArray<{
        x: number;
        y: number;
    }>>;
    properties: VectorTileProperties;
}
/**
 * Pack features into the columnar layout {@link DecodedVectorTile} holds.
 *
 * Coordinates are clamped into the `Int16Array` range. In a tile whose extent
 * is 4096 that bound is eight tile widths away from the tile, so a clamped
 * point is far outside the canvas either way and the clamp cannot change a
 * pixel -- it only stops a wildly out-of-range producer from wrapping a line
 * back across the tile.
 *
 * A line of fewer than two points is dropped: it can't be stroked, and keeping
 * it would put empty ranges in `lineStarts` for the painter to skip.
 */
export declare function buildDecodedVectorTile(extent: number, features: readonly VectorTileFeatureInput[]): DecodedVectorTile;
/** Features in a decoded tile, which is one less than `featureLines.length`. */
export declare function vectorTileFeatureCount(tile: DecodedVectorTile): number;
/** How a feature is painted, or `null` to skip it at this zoom. */
export interface VectorTileStyle {
    color: string;
    /** Line width in CSS pixels, before the device pixel ratio. */
    width: number;
    opacity?: number;
}
export type VectorTileStyleFunction = (properties: VectorTileProperties, zoom: number) => VectorTileStyle | null;
/**
 * Turn tile bytes into geometry.
 *
 * Return `null` for a tile that holds nothing to draw -- the same class of
 * answer as an archive with no tile at that address, and not a failure, so it
 * is not reported to `onError`. A tile that is present but malformed should
 * throw instead; that is what a caller wants counted.
 */
export type VectorTileDecoder = (bytes: Uint8Array, tile: {
    x: number;
    y: number;
    z: number;
}) => Promise<DecodedVectorTile | null>;
/** The 2D canvas surface the painter needs, narrowed to what it calls. */
export interface VectorTileCanvas {
    height: number;
    width: number;
    getContext: (contextId: '2d') => VectorTileCanvasContext | null;
}
export interface VectorTileCanvasContext {
    lineCap: string;
    lineJoin: string;
    lineWidth: number;
    /**
     * The painter only ever writes a CSS color string. The union is what makes
     * a DOM `CanvasRenderingContext2D` — whose own `strokeStyle` also accepts a
     * gradient or a pattern — assignable to this interface.
     */
    strokeStyle: string | object;
    globalAlpha: number;
    beginPath: () => void;
    clearRect: (x: number, y: number, width: number, height: number) => void;
    lineTo: (x: number, y: number) => void;
    moveTo: (x: number, y: number) => void;
    stroke: () => void;
}
export interface VectorTileOverlaySourceOptions<TCanvas extends VectorTileCanvas> {
    /** Decoded-tile cache size. Tiles are small; the default covers a few screens. */
    cacheSize?: number;
    createCanvas: (width: number, height: number) => TCanvas;
    decode: VectorTileDecoder;
    /** Reported per tile; the tile itself resolves to `null` and draws nothing. */
    onError?: (reason: unknown) => void;
    style: VectorTileStyleFunction;
    tileBytes: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Uint8Array | null>;
    /** Logical tile size before `scale`. MapKit asks for 256 or 512. */
    tileSize?: number;
}
export interface VectorTileHitTestOptions {
    coordinate: VectorTileCoordinate;
    /**
     * Screen-pixel radius around the probe. The default is a fingertip rather
     * than a pixel: a one-pixel-wide river is unhittable by touch otherwise.
     */
    tolerancePx?: number;
    /** The zoom the map is displaying, which decides which tiles are consulted. */
    zoom: number;
}
export interface VectorTileOverlaySource<TCanvas extends VectorTileCanvas> {
    /** Retained bytes, exact for geometry and estimated for properties. */
    readonly cacheBytes: number;
    /** Drop every decoded tile, for example when the archive is replaced. */
    clearCache: () => void;
    /**
     * The nearest feature to a coordinate, or `null`.
     *
     * Synchronous and cache-only: a tap must be answered during the gesture, and
     * a tile the user can see has already been decoded to be drawn. It never
     * fetches, so a probe over a tile that has not loaded yet is a miss.
     */
    hitTest: (options: VectorTileHitTestOptions) => VectorTileHit | null;
    /** Pass to `createMapKitAsyncTileOverlay` or a `MapKitAsyncLayerDescriptor`. */
    imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>;
    /** Decoded tiles held right now. */
    readonly size: number;
    /**
     * Swap the style. Cached tiles repaint on the next request without a
     * refetch or a re-decode, which is what makes a lens change fast.
     */
    setStyle: (style: VectorTileStyleFunction) => void;
}
/**
 * Bytes a decoded tile retains.
 *
 * Geometry and indexes are exact. Properties are estimated, because they are
 * ordinary objects and only the engine knows their real footprint -- but
 * leaving them out would understate a dense archive badly, since a `name`
 * string on each of a few thousand features per tile is what actually grows
 * the cache. The estimate charges two bytes per character of every key and
 * string value, eight for a number, and a flat per-entry overhead; it is
 * meant for sizing `cacheSize` against a budget, not for exact accounting.
 */
export declare function decodedVectorTileBytes(tile: DecodedVectorTile): number;
/**
 * Paint one decoded tile. Exported because the hit-test and the overlay need
 * the same tile-to-pixel mapping, and a test can call it directly.
 */
export declare function paintVectorTile(canvas: VectorTileCanvas, tile: DecodedVectorTile, options: {
    pixelRatio: number;
    style: VectorTileStyleFunction;
    tileSize: number;
    zoom: number;
}): boolean;
/**
 * Build the `imageForTile` function for a vector tile archive.
 *
 * An empty tile, a missing tile and a failed decode all resolve to `null`, so
 * MapKit draws nothing there instead of a blank square over the basemap.
 */
export declare function createVectorTileOverlaySource<TCanvas extends VectorTileCanvas>(options: VectorTileOverlaySourceOptions<TCanvas>): VectorTileOverlaySource<TCanvas>;
//# sourceMappingURL=vector-tiles.d.ts.map