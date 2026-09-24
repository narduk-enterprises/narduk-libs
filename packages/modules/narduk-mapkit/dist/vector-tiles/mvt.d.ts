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
     * Worth setting on a dense archive: properties are the only part of a
     * decoded tile that is not a flat buffer, so a `name` string on each of a
     * few thousand reaches per tile is what actually grows the cache.
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
//# sourceMappingURL=mvt.d.ts.map