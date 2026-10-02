/**
 * Canvas point layer: tens of thousands of dots painted into tile images.
 *
 * The national river map has to show every gauge at once (23,597 today) at
 * continental zoom. A DOM annotation per gauge was built around hundreds, and
 * MapKit JS still has no vector point overlay, so the same path the line
 * painter uses -- paint a tile, hand MapKit the image -- is what this does
 * for dots.
 *
 * Input is columnar typed arrays, not an array of objects: interleaved
 * longitude/latitude, a class byte per point, an optional flags column.
 * Positions are projected once. Replacing the class column, or the style
 * table, restyles from those projected coordinates; nothing is refetched and
 * nothing is re-projected. A missing class does not fall back to zero.
 *
 * Reserved class bytes keep "no data" and "not reporting" visually distinct
 * from each other and from the lowest real class. Those states are unknown,
 * not a guess and not a zero.
 */
import type { VectorTileCoordinate } from './hit-test.js';
/** Class byte for a gauge with no observation. Not zero, and not a guess. */
export declare const POINT_CLASS_NO_DATA = 255;
/** Class byte for a gauge that is not reporting. Distinct from no-data. */
export declare const POINT_CLASS_NOT_REPORTING = 254;
/**
 * Per-tile CPU budget for painting the national gauge set (23,597 points) at
 * zoom 3–4, including a 2× device pixel ratio. Measured in
 * `tests/point-layer.test.ts` as the mean of repeated paints of the densest
 * tile, so a loaded host's scheduler spikes do not fail the suite. The work
 * is the index walk plus draw calls; rasterisation cost is the host's.
 */
export declare const POINT_LAYER_NATIONAL_TILE_BUDGET_MS = 50;
/** How a class byte is painted. Higher `order` is drawn later, on top. */
export interface PointClassStyle {
    fill: string;
    /** Higher severity paints later so it stays visible in a pile-up. */
    order: number;
    /** Radius in CSS pixels, before the device pixel ratio. */
    radius: number;
    stroke: string;
    /** Stroke width in CSS pixels. Default 1. */
    strokeWidth?: number;
}
/**
 * Style table keyed by class byte. The two reserved classes are required so
 * they cannot silently inherit class 0.
 */
export interface PointClassTable {
    readonly [POINT_CLASS_NO_DATA]: PointClassStyle;
    readonly [POINT_CLASS_NOT_REPORTING]: PointClassStyle;
    readonly [classByte: number]: PointClassStyle | undefined;
}
export type PointPositions = Float32Array | Float64Array;
/** The 2D canvas surface the painter needs, narrowed to what it calls. */
export interface PointLayerCanvas {
    height: number;
    width: number;
    getContext: (contextId: '2d') => PointLayerCanvasContext | null;
}
export interface PointLayerCanvasContext {
    fillStyle: string | object;
    lineWidth: number;
    strokeStyle: string | object;
    arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void;
    beginPath: () => void;
    clearRect: (x: number, y: number, width: number, height: number) => void;
    fill: () => void;
    stroke: () => void;
}
export interface PointLayerOptions<TCanvas extends PointLayerCanvas> {
    /** One class byte per point. Replaced with {@link PointLayer.setClasses}. */
    classes: Uint8Array;
    createCanvas: (width: number, height: number) => TCanvas;
    /**
     * Optional flags column, one byte per point. L1 carries it aligned with the
     * other columns and does not interpret the bits.
     */
    flags?: Uint8Array;
    /** Interleaved longitude, latitude. `Float32Array` or `Float64Array` only. */
    positions: PointPositions;
    style: PointClassTable;
    /** Logical tile size before `scale`. MapKit asks for 256 or 512. */
    tileSize?: number;
}
export interface PointLayer<TCanvas extends PointLayerCanvas> {
    /** Pass to `createMapKitAsyncTileOverlay` or a `MapKitAsyncLayerDescriptor`. */
    imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>;
    /**
     * Index of the nearest painted dot within `toleranceInPixels`, or `null`.
     *
     * When the tap sits inside more than one dot, the one with the higher draw
     * order wins -- that is the one the user can see. A miss is `null`, not 0.
     */
    nearestPoint: (coordinate: VectorTileCoordinate, toleranceInPixels: number, zoom: number) => number | null;
    readonly pointCount: number;
    /** Replace the class column. Positions stay as they were projected. */
    setClasses: (classes: Uint8Array) => void;
    /** Swap the style table. Cached projection and the spatial index stay. */
    setStyle: (style: PointClassTable) => void;
}
/** Style after defaults (`strokeWidth`) are filled in. One slot per class byte. */
export interface PointLayerStyleSlot {
    fill: string;
    order: number;
    radius: number;
    stroke: string;
    strokeWidth: number;
}
/**
 * Tiles a styled dot occupies at `zoom`, including neighbours its radius
 * straddles. Longitude wraps; latitude does not.
 */
export declare function pointLayerTilesForPoint(coordinate: VectorTileCoordinate, zoom: number, radiusPx: number, tileSize?: number): Array<{
    x: number;
    y: number;
}>;
/**
 * Paint the points that belong to one tile. Exported so a test can call it
 * without standing up the overlay source.
 */
export declare function paintPointLayerTile(canvas: PointLayerCanvas, options: {
    classes: Uint8Array;
    indexes: ArrayLike<number>;
    pixelRatio: number;
    style: ReadonlyArray<PointLayerStyleSlot | undefined>;
    tileSize: number;
    tileX: number;
    tileY: number;
    worldX: Float64Array;
    worldY: Float64Array;
    zoom: number;
}): boolean;
export declare function createPointLayer<TCanvas extends PointLayerCanvas>(options: PointLayerOptions<TCanvas>): PointLayer<TCanvas>;
//# sourceMappingURL=point-layer.d.ts.map