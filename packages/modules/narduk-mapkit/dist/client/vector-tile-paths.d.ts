import type { PointLayerView } from './point-layer.js';
import type { DecodedVectorTile } from './vector-tiles.js';
/** One stretch of a path, in the order the water (or the traveller) goes. */
export interface VectorTilePathStretch {
    /** The feature id the tiles carry (`si` for the national river network). */
    id: number;
    /** Ground length of the whole stretch in metres, for the distance a piece starts at. */
    meters: number;
}
/** One drawable line of a path, in screen pixels. */
export interface VectorTilePathPiece {
    /** Metres from the start of the path to where this piece begins. */
    distanceM: number;
    /** The stretch's feature id. */
    id: number;
    /** Interleaved `x, y` in CSS pixels from the top-left of the view; two points or more. */
    points: Float32Array;
    /** Index of the stretch in the path it came from. */
    rank: number;
}
/** Pixels one metre of ground spans at this view's latitude and zoom. */
export declare function pixelsPerMeter(view: PointLayerView): number;
/** The tile addresses a view reaches at one zoom, with its margin. */
export declare function tilesInView(view: PointLayerView, zoom: number, marginPx: number): Array<{
    x: number;
    y: number;
}>;
export interface CollectVectorTilePathPiecesOptions {
    /** Tiles beyond the view whose lines are still returned, in CSS pixels. Default 64. */
    marginPx?: number;
    /** The stretches of the path, in order. A stretch the tiles lack adds no piece. */
    stretches: readonly VectorTilePathStretch[];
    /** The decoded tile at `z/x/y` (`x` wrapped into range), or nothing. */
    tileAt: (z: number, x: number, y: number) => DecodedVectorTile | null | undefined;
    view: PointLayerView;
    /** The tile zoom to read. */
    zoom: number;
}
/**
 * The pieces of a path at one tile zoom, ordered along the path.
 *
 * Within one stretch the pieces are ordered along the stretch's own net
 * direction, so a stretch that crosses a tile edge comes back as two pieces,
 * upstream first. Each piece carries the metres from the start of the path to
 * where it begins: its stretch's start, plus its share of that stretch's
 * length by pixel length.
 */
export declare function collectVectorTilePathPieces(options: CollectVectorTilePathPiecesOptions): VectorTilePathPiece[];
/** The tile zooms worth trying for a view, nearest the view's own first. */
export declare function candidateTileZooms(zoom: number, dataZoom: (zoom: number) => number): number[];
//# sourceMappingURL=vector-tile-paths.d.ts.map