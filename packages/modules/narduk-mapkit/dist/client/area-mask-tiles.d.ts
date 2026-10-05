/**
 * Everything outside some areas, covered: a cut-out.
 *
 * A state page wants the map to show that state and nothing else, with the
 * country around it quietly blanked. This is the inverse of
 * {@link createAreaOutlineTileSource}: a tile overlay whose image is a flat
 * colour with the chosen areas cut out of it, and, if asked, a line round each
 * cut-out. Place it above the network in a layer registry and the network, the
 * basemap and anything below it show only inside the areas.
 *
 * The cut is one even-odd fill: the tile's rectangle plus the rings of the
 * areas, so a point of the tile is covered when it lies inside an even number
 * of those shapes. A hole in an area (a lake of its own, an enclave) is
 * covered again, which is the right answer for a state. Each area is read from
 * the same index the outline source and the pointer use, so a multi-polygon
 * (Michigan's two peninsulas, Hawaii's islands, the Aleutians on either side
 * of the antimeridian) is cut out in every part. The shapes are also tried one
 * world to the east and west, so a map that shows the world repeated, or asks
 * for a tile index outside 0..2^z-1, is cut at the same places.
 *
 * A tile no area reaches is one flat colour: those images are made once per
 * size and shared, like any solid overlay tile.
 */
import type { VectorTileAreaIndex } from './vector-tile-areas.js';
import type { VectorTileCanvas } from './vector-tiles.js';
export interface AreaMaskLayer<TData = unknown> {
    /** The cut-out's line, drawn over the mask's edge. Omit for none. */
    edge?: {
        color: string;
        opacity?: number;
        width: number;
    };
    /** The covering colour. Opaque is the point; quieten it with the overlay's opacity. */
    fillColor: string;
    /** Default 1. */
    fillOpacity?: number;
    /** Which areas stay uncovered. Default: every area of the index. */
    ids?: readonly string[];
    index: VectorTileAreaIndex<TData>;
}
export interface AreaMaskTileSourceOptions<TCanvas extends VectorTileCanvas> {
    createCanvas: (width: number, height: number) => TCanvas;
    /** What to cover, or `null` for no mask yet (every tile answers `null`). */
    layer?: AreaMaskLayer | null;
    /** Logical tile size before the device scale. MapKit asks for 256. */
    tileSize?: number;
}
export interface AreaMaskTileSource<TCanvas extends VectorTileCanvas> {
    /** Pass as the `imageForTile` of a layer descriptor. */
    imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>;
    readonly layer: AreaMaskLayer | null;
    /** Use another mask from the next tile on. The caller replaces the overlay to repaint at once. */
    setLayer: (layer: AreaMaskLayer | null) => void;
}
export declare function createAreaMaskTileSource<TCanvas extends VectorTileCanvas>(options: AreaMaskTileSourceOptions<TCanvas>): AreaMaskTileSource<TCanvas>;
//# sourceMappingURL=area-mask-tiles.d.ts.map