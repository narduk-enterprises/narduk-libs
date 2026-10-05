import type { VectorTileCanvas } from './vector-tiles.js';
import type { VectorTileCoordinate } from './hit-test.js';
/** The GeoJSON an area is drawn from. Anything but a Polygon or MultiPolygon has no area. */
export interface VectorTileAreaGeometry {
    coordinates: unknown;
    type: string;
}
/** One area as an app describes it. */
export interface VectorTileAreaInput<TData = unknown> {
    /** Carried to the hit. Not read by this package. */
    data?: TData;
    /** `null` or an unreadable shape: the area is listed in {@link VectorTileAreaIndex.skipped}. */
    geometry: VectorTileAreaGeometry | null | undefined;
    id: string;
    /**
     * Higher draws on top and wins a hit. Default 0. Among equal priorities the
     * area given earlier is on top and wins, so pass the areas most-severe first.
     */
    priority?: number;
}
/** How an area is painted. `fillColor` and `strokeColor` are both optional. */
export interface VectorTileAreaStyle {
    /** Omit for an outline only. */
    fillColor?: string;
    /** Default 1. */
    fillOpacity?: number;
    /** Stroke width in CSS pixels. Default 1; 0 draws no outline. */
    lineWidth?: number;
    /** Omit for a fill only. */
    strokeColor?: string;
    /** Default 1. */
    strokeOpacity?: number;
}
/** One polygon of an area: an outer ring and its holes, in Web Mercator world units. */
export interface VectorTileAreaShape {
    /** `[west, north, east, south]` in world units, 0 to 1 across the world. */
    box: readonly [number, number, number, number];
    /** Interleaved `x, y` world coordinates, 0 to 1 across the world, y down. */
    coordinates: Float64Array;
    /** Where each ring begins as a point index; one more than the ring count. */
    ringStarts: Uint32Array;
}
/** An area ready to paint and hit-test. */
export interface VectorTileArea<TData = unknown> {
    /** `[west, south, east, north]` in degrees, covering every polygon of the area. */
    readonly bounds: readonly [number, number, number, number];
    readonly data: TData | undefined;
    readonly id: string;
    readonly priority: number;
    readonly shapes: readonly VectorTileAreaShape[];
}
export interface VectorTileAreaIndex<TData = unknown> {
    /** Every area with a shape, in hit order: highest priority first, then as given. */
    readonly areas: ReadonlyArray<VectorTileArea<TData>>;
    /** The box of an area in degrees, `[west, south, east, north]`, or `null` for an id it lacks. */
    boundsOf: (id: string) => readonly [number, number, number, number] | null;
    get: (id: string) => VectorTileArea<TData> | undefined;
    /** The area under a point that `accept` allows, or `null`. */
    hitTest: (coordinate: VectorTileCoordinate, accept?: (area: VectorTileArea<TData>) => boolean) => VectorTileArea<TData> | null;
    /** Every area under a point that `accept` allows, in hit order. */
    hitTestAll: (coordinate: VectorTileCoordinate, accept?: (area: VectorTileArea<TData>) => boolean) => Array<VectorTileArea<TData>>;
    /** Ids given without a shape this package could read: listed by the app, never drawn. */
    readonly skipped: readonly string[];
}
/**
 * What the overlay draws and hit-tests: an index, and the style each of its
 * areas gets right now. `style` returns `null` for an area that is not drawn,
 * and an area that is not drawn is not hit either. It runs once per area per
 * tile painted, so it must be a plain lookup.
 */
export interface VectorTileAreaLayer<TData = unknown> {
    index: VectorTileAreaIndex<TData>;
    style: (area: VectorTileArea<TData>) => VectorTileAreaStyle | null;
}
/**
 * Read areas into an index. An input with no geometry, or one that is not a
 * Polygon or MultiPolygon with a readable ring, is not drawn and not hit; its
 * id is in `skipped` so the app can say its area could not be drawn instead of
 * dropping it.
 */
export declare function createVectorTileAreaIndex<TData = unknown>(inputs: ReadonlyArray<VectorTileAreaInput<TData>>): VectorTileAreaIndex<TData>;
/** The address of a displayed tile. */
export interface VectorTileAddress {
    x: number;
    y: number;
    z: number;
}
/**
 * Whether anything the layer draws reaches this tile. A tile that nothing
 * reaches needs no area pass, and a tile with no lines under it needs none of
 * the network's either.
 */
export declare function vectorTileAreasReach<TData>(layer: VectorTileAreaLayer<TData> | null, tile: VectorTileAddress, tileSize: number): boolean;
/**
 * Paint a layer's areas into a tile image, in priority order with the most
 * important on top. Returns `false` when nothing was drawn, including a canvas
 * that cannot fill.
 *
 * It does not clear the canvas: the network is painted over it afterwards, and
 * a caller that wants a clean canvas clears it first. `tile` is the tile being
 * displayed, so a tile above the archive's last zoom needs no special case.
 */
export declare function paintVectorTileAreas<TData>(canvas: VectorTileCanvas, layer: VectorTileAreaLayer<TData>, options: {
    pixelRatio: number;
    tile: VectorTileAddress;
    tileSize: number;
}): boolean;
//# sourceMappingURL=vector-tile-areas.d.ts.map