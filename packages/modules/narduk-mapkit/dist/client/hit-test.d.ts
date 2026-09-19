/**
 * Answer "what did I just tap?" against decoded vector tiles.
 *
 * A tap on a river has to resolve now, on the tap, so this reads only what is
 * already cached and never fetches: a tile the user can see has been decoded
 * to be drawn, so the tiles that matter are the tiles in hand. A miss returns
 * `null` rather than waiting on a network read that would land after the
 * gesture is over.
 *
 * Distances are computed in tile-local units and reported in screen pixels,
 * because tolerance is a property of the finger, not of the projection.
 */
import type { DecodedVectorTile, VectorTileProperties } from './vector-tiles.js';
export interface VectorTileCoordinate {
    latitude: number;
    longitude: number;
}
/** Where a coordinate falls in the tile pyramid at one zoom. */
export interface TilePoint {
    /** Tile-local position, in the tile's own extent units. */
    x: number;
    y: number;
    /** Tile address containing the point. */
    tileX: number;
    tileY: number;
}
export interface VectorTileHit {
    /** Distance from the probe to the line, in screen pixels. */
    distancePx: number;
    /** Index of the feature within its tile, for `tile.properties`. */
    feature: number;
    properties: VectorTileProperties;
    tile: {
        x: number;
        y: number;
        z: number;
    };
}
/**
 * Project a coordinate into the tile pyramid at `zoom`.
 *
 * `x` and `y` come back in the tile's own extent units rather than as a
 * fraction, so a caller compares them against geometry without rescaling.
 * Longitude wraps, so a probe at 181 degrees lands where 179 west does.
 */
export declare function projectToTilePoint(coordinate: VectorTileCoordinate, zoom: number, extent: number): TilePoint;
export interface TileHit {
    /** Tile-local distance, in extent units. */
    distance: number;
    feature: number;
}
/**
 * Nearest feature in one decoded tile, or `null` if none is within `within`.
 *
 * The walk is over the flat arrays directly: a tile of flowlines is on the
 * order of 10^5 points, and materialising a point object per candidate during
 * a gesture is what a columnar tile exists to avoid. Comparison stays squared
 * until the end, so the loop has no square root in it.
 *
 * The probe may sit outside `[0, extent]` -- that is how a neighbouring tile is
 * asked whether its geometry reaches back across the shared edge -- so nothing
 * here assumes the point is inside the tile.
 */
export declare function hitTestTile(tile: DecodedVectorTile, x: number, y: number, within: number): TileHit | null;
/** The tile addresses a probe can reach, given how close it is to an edge. */
export declare function hitTestNeighbours(point: TilePoint, zoom: number, extent: number, within: number): Array<{
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
}>;
//# sourceMappingURL=hit-test.d.ts.map