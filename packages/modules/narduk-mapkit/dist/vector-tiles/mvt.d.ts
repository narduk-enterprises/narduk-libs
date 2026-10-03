import type { DecodedVectorTile, VectorTileDecoder } from '../client/vector-tiles.js';
export interface MvtDecoderOptions {
    /**
     * Layers to read, in the archive's own naming. Omit to read every layer.
     * Naming them is cheaper than filtering later: an unread layer is never
     * walked, and a tile product often carries labels beside the geometry.
     */
    layers?: readonly string[];
    /**
     * Property keys to keep. Omit to keep every key.
     *
     * Worth setting on a dense archive: leftover strings are the only part of a
     * decoded tile that is not a flat buffer. `so`, `si` and `ri` become typed
     * columns either way; dropping `name` is what actually shrinks the cache.
     */
    properties?: readonly string[];
}
/**
 * Build a {@link VectorTileDecoder} over `@mapbox/vector-tile`.
 *
 * Point features fall out on their own: a run of fewer than two points cannot
 * be stroked, and {@link buildDecodedVectorTile} drops it. Polygon rings are
 * kept and stroked as lines, which is what an outline wants.
 *
 * The empty/failed split follows the {@link VectorTileDecoder} contract:
 * empty bytes, a tile whose layers the filter excludes, and a layer with no
 * features all decode to `null`, which is "nothing to draw" and not worth
 * reporting. Bytes that are present but hold no layer at all are not a vector
 * tile, so they throw -- that is a wrong archive or a truncated read, and a
 * caller wants it counted rather than silently drawn as blank country.
 */
export declare function createMvtDecoder(options?: MvtDecoderOptions): VectorTileDecoder;
/** The synchronous core, so a worker can call it without a microtask hop. */
export declare function decodeMvtTile(bytes: Uint8Array, options?: MvtDecoderOptions): DecodedVectorTile | null;
/**
 * Take the staircase a coarse tile grid leaves out of a layer's lines.
 *
 * A low-zoom tile built on a 256 or 512 grid quantises every gentle curve into
 * horizontal and vertical unit steps, and river-network v3 stores those steps
 * as separate two-point lines (about 2.1 points a line at z3 and z4). Drawn on
 * a 2x or 3x canvas each step is a visible stair and the network reads as a
 * blocky mesh. No single line holds a staircase, so this works on the layer's
 * whole network: every point is a node, joined to the points it is drawn to.
 * A node joined to exactly two others (the middle of a run, whichever lines
 * carry it) moves halfway towards their average, `SMOOTHING_PASSES` times;
 * a staircase of unit steps becomes a straight line about a third of a unit
 * from its centre. Junctions, ends and crossings (any other number of joins)
 * stay exactly where the tile put them, so lines still meet where they met,
 * and a shared point moves once for every line that carries it. Nothing moves
 * more than about one grid unit, which is the quantisation itself.
 *
 * Takes and returns one entry per feature, each a list of lines.
 */
export declare function smoothCoarseNetwork(features: ReadonlyArray<ReadonlyArray<ReadonlyArray<{
    x: number;
    y: number;
}>>>, passes?: number): Array<Array<Array<{
    x: number;
    y: number;
}>>>;
//# sourceMappingURL=mvt.d.ts.map