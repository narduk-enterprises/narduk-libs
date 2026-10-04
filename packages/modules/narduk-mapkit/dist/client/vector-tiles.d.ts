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
/**
 * Sentinel in `si` / `ri` columns when that feature did not carry the key.
 * A class-table lookup treats it as unknown, never as id 0.
 */
export declare const VECTOR_TILE_MISSING_ID = 4294967295;
/** Reserved class byte: a gauge is on this stretch but is not reporting. */
export declare const VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING = 254;
/**
 * Reserved class byte: no gauge on this stretch. Drawn in the style's
 * `noGauge` paint — a neutral water colour — not the unknown grey.
 */
export declare const VECTOR_TILE_CLASS_NO_GAUGE = 255;
/** A decoded feature's properties, as a vector tile carries them. */
export type VectorTileProperties = Record<string, boolean | number | string | null>;
export type VectorTileClassKey = 'si' | 'ri';
/**
 * Identity of the tile archive a class table must match.
 *
 * The table's declared version and length are compared to this, not guessed
 * from the bytes on a feature. A mismatch paints every feature as unknown
 * rather than a colour that belongs to a different network revision.
 */
export interface VectorTileNetworkIdentity {
    length: number;
    version: number | string;
}
/**
 * One byte per dense id (`si` or `ri`). Index `i` is the class of that id.
 *
 * `length` is the declared id-space, and must equal `classes.length` as well
 * as the tile archive's length. `networkVersion` is the revision those ids
 * were assigned under.
 */
export interface VectorTileClassTable {
    classes: Uint8Array;
    length: number;
    networkVersion: number | string;
}
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
 * `so`, `si` and `ri` are the same idea for the properties a national river
 * network styles by: one typed column per tile, not one object per feature.
 * A class-table style reads only those columns. The `properties` array stays
 * for the existing per-feature style function and for hit-test.
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
    /**
     * Reach index per feature, present from zoom 8 in tiles v2. Omitted when no
     * feature in the tile carried `ri` (a v1 low-zoom tile).
     */
    ri?: Uint32Array;
    /**
     * Dense segment id per feature, present at every zoom in tiles v2. Omitted
     * when no feature carried `si` — that is a v1 tile, and it still paints.
     */
    si?: Uint32Array;
    /** Stream order per feature. Omitted when no feature carried `so`. */
    so?: Uint8Array;
}
/** A feature as a caller describes it, before it is packed into flat arrays. */
export interface VectorTileFeatureInput {
    /** One entry per line; each is a run of tile-local points. */
    lines: ReadonlyArray<ReadonlyArray<{
        x: number;
        y: number;
    }>>;
    properties: VectorTileProperties;
    /** Overrides `properties.ri` when packing the `ri` column. */
    ri?: number;
    /** Overrides `properties.si` when packing the `si` column. */
    si?: number;
    /** Overrides `properties.so` when packing the `so` column. */
    so?: number;
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
 *
 * `so`, `si` and `ri` become typed columns when at least one feature carries
 * them. A missing id in an otherwise-present `si`/`ri` column is
 * {@link VECTOR_TILE_MISSING_ID}, so a class-table lookup cannot mistake it
 * for id 0.
 */
export declare function buildDecodedVectorTile(extent: number, features: readonly VectorTileFeatureInput[]): DecodedVectorTile;
/** Features in a decoded tile, which is one less than `featureLines.length`. */
export declare function vectorTileFeatureCount(tile: DecodedVectorTile): number;
/** How a feature is painted, or `null` to skip it at this zoom. */
export interface VectorTileStyle {
    /**
     * Optional outline drawn under the line so it stays readable on the
     * basemap. `extraWidth` is added to `width` for that stroke only.
     */
    casing?: VectorTileCasing;
    color: string;
    opacity?: number;
    /**
     * Draw-order key after stream order. Higher sits on top. A class-table
     * style uses the class byte; a function style may set this explicitly.
     */
    severity?: number;
    /** Line width in CSS pixels, before the device pixel ratio. */
    width: number;
}
export interface VectorTileCasing {
    color: string;
    extraWidth: number;
}
export type VectorTileStyleFunction = (properties: VectorTileProperties, zoom: number) => VectorTileStyle | null;
/**
 * Colour by a class byte looked up in a table, not by calling a style
 * function per feature.
 *
 * Below `zoomThreshold` the table is indexed by `keyBelowZoom` (`si` by
 * default); from that zoom it is indexed by `keyFromZoom` (`ri` by default).
 * Reserved bytes stay distinct from `paintByClass` even if that array has
 * entries at 254 or 255.
 */
export interface VectorTileClassStyle {
    /**
     * Outline drawn under every batch. A per-feature `casing` on the resolved
     * paint, if present, wins for that feature.
     */
    casing?: VectorTileCasing;
    classTable: VectorTileClassTable;
    gaugeNotReporting: VectorTileStyle;
    keyBelowZoom?: VectorTileClassKey;
    keyFromZoom?: VectorTileClassKey;
    noGauge: VectorTileStyle;
    /**
     * Paint for class bytes 0–253. A missing entry, and every reserved or
     * unknown state, uses `unknown` / `gaugeNotReporting` / `noGauge` instead.
     */
    paintByClass: ReadonlyArray<VectorTileStyle | null | undefined>;
    /**
     * Archive this style was built for. When omitted, the overlay source's
     * `tileNetwork` is the one compared to the table.
     */
    tileNetwork?: VectorTileNetworkIdentity;
    unknown: VectorTileStyle;
    zoomThreshold?: number;
}
export type VectorTileOverlayStyle = VectorTileStyleFunction | VectorTileClassStyle;
export declare function isVectorTileClassStyle(style: VectorTileOverlayStyle): style is VectorTileClassStyle;
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
/**
 * The registry half of a restyle. Structural so `./client` does not have to
 * name `MapKitLayerRegistry` here: any object that can `replace` a layer
 * with `activateWhen: 'first-image'` is enough.
 */
export interface VectorTileRestyleHost<TImage = unknown> {
    descriptor?: {
        data?: unknown;
        maximumZ?: number;
        minimumZ?: number;
        onTileError?: (reason: unknown) => void;
        opacity?: number;
        order?: number;
    };
    layerId: string;
    replace: (id: string, descriptor: {
        data?: unknown;
        id: string;
        imageForTile: (x: number, y: number, z: number, scale: number, data?: unknown) => Promise<TImage | null>;
        maximumZ?: number;
        minimumZ?: number;
        onTileError?: (reason: unknown) => void;
        opacity?: number;
        order?: number;
    }, options?: VectorTileRestyleReplaceOptions) => Promise<void>;
    replaceOptions?: VectorTileRestyleReplaceOptions;
}
export interface VectorTileRestyleReplaceOptions {
    activateWhen?: 'immediate' | 'first-image';
    crossfadeDurationMs?: number;
    readinessTimeoutMs?: number;
    signal?: AbortSignal;
}
/**
 * Where a tile source reports the deepest zoom its archive holds. A
 * {@link PmTilesTileSource} does, from the archive header.
 */
export interface VectorTileArchive {
    getMaxZoom?: () => number | Promise<number | undefined> | undefined;
}
/** Everything a painter needs besides the decoded tile itself. */
export interface VectorTilePaintRequest {
    /** Present when the tile is painted from an ancestor's geometry. */
    overzoom?: VectorTileOverzoom;
    pixelRatio: number;
    style: VectorTileOverlayStyle;
    tileNetwork?: VectorTileNetworkIdentity;
    tileSize: number;
    zoom: number;
}
/**
 * Paints a decoded tile somewhere other than the main thread.
 *
 * `paint` returns `null` when it cannot take this request at all (a style it
 * cannot carry, a browser without `OffscreenCanvas`), and its promise rejects
 * with {@link VectorTilePaintUnavailableError} when it found that out later.
 * Either way the overlay paints that tile on the main thread instead, so a
 * painter can only ever move work, never lose a tile. Any other rejection is
 * a failed tile, reported to `onError`.
 */
export interface VectorTilePainter<TImage> {
    paint: (tile: DecodedVectorTile, request: VectorTilePaintRequest) => Promise<TImage | null> | null;
}
/** A painter could not take a request; the overlay paints it on the main thread. */
export declare class VectorTilePaintUnavailableError extends Error {
    constructor(message: string);
}
export interface VectorTileOverlaySourceOptions<TCanvas extends VectorTileCanvas, TImage = TCanvas> {
    /**
     * The tile source, when it can say how deep the archive goes. Used for the
     * default `maxDataZoom`. Optional, and only read when `maxDataZoom` is unset.
     */
    archive?: VectorTileArchive;
    /**
     * Decoded-tile cache budget in bytes, by {@link decodedVectorTileBytes}. Least
     * recently used tiles are evicted to stay under it. Default
     * {@link DEFAULT_VECTOR_TILE_CACHE_BYTES}; `Infinity` means no byte cap. A
     * tile larger than the whole budget still paints but is not retained.
     */
    cacheBytes?: number;
    /**
     * Decoded-tile count cap. Default 256. It holds alongside `cacheBytes`:
     * whichever limit is reached first evicts.
     */
    cacheSize?: number;
    createCanvas: (width: number, height: number) => TCanvas;
    decode: VectorTileDecoder;
    /**
     * The overlay the highlight is drawn on, swapped when the highlight changes.
     * Structural like `restyleHost`, and a different layer from the network's:
     * changing the highlight never swaps, repaints or re-reads the base tiles.
     * Without one, {@link VectorTileOverlaySource.highlightImageForTile} still
     * answers and the app reloads its own highlight overlay.
     */
    highlightHost?: VectorTileRestyleHost<TCanvas>;
    /**
     * The deepest zoom the archive has data for. A tile asked for above it is
     * painted from its ancestor at this zoom, scaled and clipped into the child,
     * so the archive is read and decoded once for every descendant.
     * Default: `archive.getMaxZoom()` when that exists, else no overzoom.
     */
    maxDataZoom?: number;
    /**
     * Reported per tile; the tile itself resolves to `null` and draws nothing.
     * A read that was dropped or aborted because the map left its zoom is not an
     * error and is not reported.
     */
    onError?: (reason: unknown) => void;
    /**
     * Paint network tiles off the main thread, for example
     * `createWorkerTileService(...).painter`. A request the painter declines is
     * painted here with `createCanvas`, as it is without one. The highlight is
     * always painted here: it strokes a handful of lines.
     */
    painter?: VectorTilePainter<TImage>;
    /**
     * Tile reads in flight at once, default 6. Reads past it wait in a queue
     * served newest first; see {@link createVectorTileOverlaySource}.
     */
    readConcurrency?: number;
    restyleHost?: VectorTileRestyleHost<TCanvas | TImage>;
    style: VectorTileOverlayStyle;
    /**
     * Read one tile's bytes. `signal` aborts when the map has left the tile's
     * zoom; pass it to the range fetch. Resolve `null` or reject once it aborts.
     */
    tileBytes: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Uint8Array | null>;
    /**
     * Version and id-space the loaded tiles were built for. A class table that
     * does not declare the same pair paints every feature as unknown.
     */
    tileNetwork?: VectorTileNetworkIdentity;
    /** Logical tile size before `scale`. MapKit asks for 256 or 512. */
    tileSize?: number;
}
/** How the highlighted stretch is drawn: one stroke, with an optional casing under it. */
export type VectorTileHighlightStyle = Omit<VectorTileStyle, 'severity'>;
/**
 * A stretch to light up: every decoded piece whose `si` column equals `id`.
 * `VECTOR_TILE_MISSING_ID` is allowed and matches nothing.
 */
export interface VectorTileHighlight {
    id: number;
    style: VectorTileHighlightStyle;
}
/**
 * One stroke of a highlight plan: a highlight style with a draw order. Lower
 * `layer`s are stroked first, so a wide faint halo (layer 0) sits under the
 * line it surrounds (layer 1). Strokes in the same layer draw in stream order,
 * trunks over tributaries.
 */
export interface VectorTileHighlightStroke extends VectorTileHighlightStyle {
    layer?: number;
}
/**
 * Many stretches lit at once, each in its own style (a river, the path it
 * flows down and the tributaries above it).
 *
 * The overlay asks the plan about every piece of every cached tile it paints,
 * so `strokes` must be a plain lookup: no allocation beyond the strokes it
 * returns and nothing asynchronous. A stretch it returns `null` or `[]` for is
 * not drawn. `zoom` is the zoom being displayed, so a plan can follow the same
 * width ladder as the network under it.
 */
export interface VectorTileHighlightPlan {
    strokes: (si: number, streamOrder: number, zoom: number) => VectorTileHighlightStroke | readonly VectorTileHighlightStroke[] | null;
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
    /**
     * Which features can be hit at all. A feature this refuses is skipped before
     * the nearest is chosen, so it cannot shadow one behind it (a stream the
     * current zoom does not draw, beside one it does). Default: every feature.
     */
    accept?: (properties: VectorTileProperties) => boolean;
    /**
     * Which candidate within `tolerancePx` wins: the highest rank, and the
     * nearest among equal ranks. Rank a stream by its order and a creek beside a
     * big river no longer takes the pointer from it. Default: every feature
     * ranks the same, so the nearest wins.
     */
    rank?: (properties: VectorTileProperties) => number;
}
export interface VectorTileOverlaySource<TCanvas extends VectorTileCanvas, TImage = TCanvas> {
    /** Retained bytes, exact for geometry and estimated for properties. */
    readonly cacheBytes: number;
    /** Drop every decoded tile, for example when the archive is replaced. */
    clearCache: () => void;
    /** Remove the highlight everywhere. Same as `setHighlight(null)`. */
    clearHighlight: () => Promise<void>;
    /** The highlighted stretch, or `null`. */
    readonly highlight: VectorTileHighlight | null;
    /** The highlight plan, or `null`. A plan and a single highlight are never both set. */
    readonly highlightPlan: VectorTileHighlightPlan | null;
    /**
     * The highlight's own `imageForTile`, for a second overlay above the
     * network. Draws every cached piece whose `si` equals the highlighted id (or
     * that the highlight plan strokes),
     * from the decoded cache alone: it never reads, never decodes and never
     * touches the read queue. A tile whose read is still in flight is awaited; a
     * tile that is not cached and not loading resolves `null` and is drawn when
     * its base tile next arrives (the overlay is refreshed through the
     * `highlightHost`). Above `maxDataZoom` it draws from the ancestor's
     * geometry, as the base tile does.
     */
    highlightImageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>;
    /**
     * The nearest feature to a coordinate, or `null`.
     *
     * Synchronous and cache-only: a tap must be answered during the gesture, and
     * a tile the user can see has already been decoded to be drawn. It never
     * fetches, so a probe over a tile that has not loaded yet is a miss.
     *
     * Above the data zoom the probe is answered from the ancestor tile, and the
     * hit's `tile` is that ancestor -- the tile `feature` indexes into.
     */
    hitTest: (options: VectorTileHitTestOptions) => VectorTileHit | null;
    /**
     * Pass to `createMapKitAsyncTileOverlay` or a `MapKitAsyncLayerDescriptor`.
     * With a `painter` it resolves the painter's image, or a canvas for a tile
     * the painter declined.
     */
    imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | TImage | null>;
    /**
     * Repaint from the decoded cache and, when a restyle host is attached,
     * swap the overlay through the registry's swap-when-drawn path. Rapid
     * successive calls coalesce to the latest style.
     */
    restyle: (style: VectorTileOverlayStyle) => Promise<void>;
    /**
     * Replace the class table and restyle. A table whose version or length
     * does not match the tiles draws unknown, never a wrong colour.
     */
    setClassTable: (table: VectorTileClassTable) => Promise<void>;
    /**
     * Highlight a stretch, or pass `null` to clear it. Only the highlight
     * overlay is swapped (through `highlightHost` when one is attached); the
     * base network tiles are not re-read, re-decoded or repainted. Rapid calls
     * coalesce to the latest.
     */
    setHighlight: (highlight: VectorTileHighlight | null) => Promise<void>;
    /**
     * Light many stretches in many styles (see {@link VectorTileHighlightPlan}),
     * or pass `null` to clear. Replaces a single highlight, and is replaced by
     * one. Swaps only the highlight overlay, like `setHighlight`.
     */
    setHighlightPlan: (plan: VectorTileHighlightPlan | null) => Promise<void>;
    setHighlightHost: (host: VectorTileRestyleHost<TCanvas> | null) => void;
    setRestyleHost: (host: VectorTileRestyleHost<TCanvas | TImage> | null) => void;
    /**
     * Swap the style in memory. Cached tiles repaint on the next request
     * without a refetch or a re-decode. Prefer {@link VectorTileOverlaySource.restyle}
     * when the overlay is on a map: `setStyle` alone cannot ask MapKit to
     * re-request tiles without a blank frame.
     */
    setStyle: (style: VectorTileOverlayStyle) => void;
    /** Decoded tiles held right now. */
    readonly size: number;
}
/**
 * Bytes a decoded tile retains.
 *
 * Geometry, indexes and class columns are exact. Properties are estimated,
 * because they are ordinary objects and only the engine knows their real
 * footprint -- but leaving them out would understate a dense archive badly,
 * since a `name` string on each of a few thousand features per tile is what
 * actually grows the cache. The estimate charges two bytes per character of
 * every key and string value, eight for a number, and a flat per-entry
 * overhead; it is meant for sizing `cacheSize` against a budget, not for
 * exact accounting.
 */
export declare function decodedVectorTileBytes(tile: DecodedVectorTile): number;
/**
 * Default decoded-tile budget, in bytes.
 *
 * A dense river-network tile (about 10^5 points and a couple of thousand
 * features) retains roughly 0.7 MB by {@link decodedVectorTileBytes}; 64 MiB
 * holds on the order of ninety of them, several screens of a phone map plus the
 * ring MapKit prefetches, and a third of what the old 256-tile count cap would
 * have kept for the same tiles. See the measurement in the pull request that
 * introduced it (narduk-libs#1345 L6) and the README. Pass `cacheBytes:
 * Infinity` to cap by count only.
 */
export declare const DEFAULT_VECTOR_TILE_CACHE_BYTES: number;
/**
 * LRU over decoded tiles, capped by count and by total decoded bytes.
 *
 * Map preserves insertion order, so the first key is the least recently used.
 * A tile larger than the whole byte budget is not retained at all -- keeping it
 * would evict everything else for one tile -- but the caller still has it in
 * hand to paint.
 *
 * Exported for the worker half of the paint protocol, which keeps its own
 * copy of the tiles it paints under the same rules.
 */
export declare class DecodedVectorTileCache {
    #private;
    constructor(limit: number, byteLimit: number);
    get bytes(): number;
    get size(): number;
    clear(): void;
    get(key: string): DecodedVectorTile | null;
    set(key: string, tile: DecodedVectorTile): void;
}
export declare const DEFAULT_VECTOR_TILE_CLASS_ZOOM_THRESHOLD = 8;
/** Reads in flight at once unless `readConcurrency` says otherwise. */
export declare const DEFAULT_VECTOR_TILE_READ_CONCURRENCY = 6;
/**
 * Whether a class table may colour these tiles.
 *
 * The table's own `length` must equal `classes.length`. When a tile-network
 * identity is supplied it must also match the table's declared version and
 * length. Anything else is a different network, and the painter must not
 * guess.
 */
export declare function classTableMatchesNetwork(table: VectorTileClassTable, tileNetwork?: VectorTileNetworkIdentity): boolean;
/** Which column a class-table style reads at `zoom`. */
export declare function vectorTileClassKeyAtZoom(style: VectorTileClassStyle, zoom: number): VectorTileClassKey;
/**
 * Class byte for one feature, or `null` when the chosen column is absent,
 * the id is missing, or the id sits outside the table.
 *
 * `null` is "no data", never 0 and never a reserved byte.
 */
export declare function vectorTileClassByte(tile: DecodedVectorTile, feature: number, key: VectorTileClassKey, table: VectorTileClassTable): number | null;
/**
 * Paint for a looked-up class byte. Reserved 254/255 and unknown stay
 * distinct from `paintByClass`, including from any entry at those indexes.
 */
export declare function paintForVectorTileClass(style: VectorTileClassStyle, classByte: number | null, compatible: boolean): VectorTileStyle;
/** The thinnest stroke the painter puts on the canvas, in device pixels. */
export declare const VECTOR_TILE_MIN_DEVICE_WIDTH = 1;
/**
 * A stroke width in device pixels, as the canvas should draw it.
 *
 * A line asked for under one device pixel is drawn one device pixel wide and
 * proportionally fainter, so a 0.3 CSS px hairline on a 3x screen is a crisp
 * 1 px line at 90% of its opacity rather than a 1.5 px one (the old floor was
 * half a CSS pixel, which made a 3x screen's hairlines thicker than asked).
 * Sub-pixel strokes are what a canvas antialiases into a grey grid; one solid
 * device pixel with the coverage moved into alpha draws the same ink, crisp.
 */
export declare function hairlineStroke(deviceWidth: number): {
    alpha: number;
    width: number;
};
/**
 * Which part of an ancestor tile a child tile shows, for overzoom.
 *
 * The child is `levels` zooms deeper than the decoded tile, so it covers
 * `1 / 2 ** levels` of the ancestor's width and height, starting at `column` /
 * `row` in units of that fraction.
 */
export interface VectorTileOverzoom {
    /** The child's column within the ancestor, `0` to `2 ** levels - 1`. */
    column: number;
    /** Zoom levels between the decoded tile and the tile being painted. */
    levels: number;
    /** The child's row within the ancestor, `0` to `2 ** levels - 1`. */
    row: number;
}
/**
 * Paint one decoded tile. Exported because the hit-test and the overlay need
 * the same tile-to-pixel mapping, and a test can call it directly.
 *
 * Lines are grouped by colour and width into one stroke per batch, then
 * drawn in stream-order then severity so a flooded stretch sits on top of
 * the same-order water under it. An optional casing is the same path,
 * stroked wider, underneath the batch.
 */
export declare function paintVectorTile(canvas: VectorTileCanvas, tile: DecodedVectorTile, options: {
    /**
     * Paint a child of `tile` -- a tile `levels` zooms deeper -- from its
     * geometry, scaled and clipped into the child. `zoom` stays the zoom being
     * displayed: line width, the style function and the class-table key all
     * follow it, while the columns come from `tile`.
     */
    overzoom?: VectorTileOverzoom;
    pixelRatio: number;
    style: VectorTileOverlayStyle;
    tileNetwork?: VectorTileNetworkIdentity;
    tileSize: number;
    zoom: number;
}): boolean;
/**
 * Paint the pieces of one decoded tile whose `si` equals `id`, in one style.
 *
 * The highlight's counterpart to {@link paintVectorTile}, over the same
 * geometry and the same overzoom window, so a highlighted stretch lies exactly
 * on the line under it. A tile with no `si` column, or no matching feature,
 * paints nothing and returns `false`.
 */
export declare function paintVectorTileHighlight(canvas: VectorTileCanvas, tile: DecodedVectorTile, options: {
    id: number;
    overzoom?: VectorTileOverzoom;
    pixelRatio: number;
    style: VectorTileHighlightStyle;
    tileSize: number;
}): boolean;
/**
 * Paint a highlight plan over one decoded tile: every piece the plan strokes,
 * batched by style into one path per stroke, layers in order.
 *
 * The plan counterpart of {@link paintVectorTileHighlight}, over the same
 * geometry and overzoom window. A tile with no `si` column, or none the plan
 * strokes, paints nothing and returns `false`.
 */
export declare function paintVectorTileHighlightPlan(canvas: VectorTileCanvas, tile: DecodedVectorTile, options: {
    overzoom?: VectorTileOverzoom;
    pixelRatio: number;
    plan: VectorTileHighlightPlan;
    tileSize: number;
    zoom: number;
}): boolean;
/**
 * Quiet time after the last tile request before tiles dropped for a zoom
 * change are asked for again. A gesture asks every frame, so this fires once
 * the zoom has settled, not between frames.
 */
export declare const VECTOR_TILE_DROP_REFRESH_MS = 300;
/**
 * Build the `imageForTile` function for a vector tile archive.
 *
 * An empty tile, a missing tile and a failed decode all resolve to `null`, so
 * MapKit draws nothing there instead of a blank square over the basemap.
 *
 * Reads go through a bounded queue (`readConcurrency`) served newest first. A
 * read for a zoom the map has since left is dropped before it starts, or
 * aborted through the `AbortSignal` handed to `tileBytes` if it already has.
 * Either way the tile resolves to `null`, is not reported to `onError`, is not
 * cached, and loads normally if it is asked for again.
 *
 * MapKit keeps that `null` as an empty tile and does not ask again, so a zoom
 * that comes back, or requests that alternate between two zooms, would leave
 * blank tiles. Once requests have been quiet for
 * {@link VECTOR_TILE_DROP_REFRESH_MS} after any drop, the overlay is swapped
 * through `restyleHost` (after the new overlay's first image, as a restyle is),
 * so every displayed tile is asked for again from the decoded cache.
 *
 * Above `maxDataZoom` a tile is painted from its ancestor at that zoom: one
 * read and one decode, shared by every descendant through the cache.
 */
export declare function createVectorTileOverlaySource<TCanvas extends VectorTileCanvas, TImage = TCanvas>(options: VectorTileOverlaySourceOptions<TCanvas, TImage>): VectorTileOverlaySource<TCanvas, TImage>;
//# sourceMappingURL=vector-tiles.d.ts.map