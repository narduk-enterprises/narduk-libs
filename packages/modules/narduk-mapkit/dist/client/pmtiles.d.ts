/**
 * PMTiles archive reads for tile overlays.
 *
 * A PMTiles archive is one file on object storage, read with HTTP range
 * requests: a header, a directory tree, then the tile bodies. This module
 * wraps the `pmtiles` reader so a tile overlay can ask for `(z, x, y)` and get
 * bytes or nothing, with the header and root directory fetched once.
 *
 * Nothing here decodes a tile. The bytes go to whatever decoder the caller
 * supplies, which for vector tiles is a worker (see `vector-tiles.ts`).
 */
/** Byte range response, shaped like the `pmtiles` package's `RangeResponse`. */
export interface PmTilesRangeResponse {
    data: ArrayBuffer;
    cacheControl?: string;
    etag?: string;
    expires?: string;
}
/** The `pmtiles` package's `Source` interface, restated so we don't import types at runtime. */
export interface PmTilesSource {
    getBytes: (offset: number, length: number, signal?: AbortSignal, etag?: string) => Promise<PmTilesRangeResponse>;
    getKey: () => string;
}
/** The subset of the `pmtiles` reader a tile source uses. */
export interface PmTilesReader {
    getZxy: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<{
        data: ArrayBuffer;
    } | undefined>;
}
export interface PmTilesTileSourceOptions {
    /** Called when a tile read fails. The read itself resolves to `null`. */
    onError?: (reason: unknown) => void;
    /** The archive reader. Inject a fake in tests; in an app, a `pmtiles` `PMTiles`. */
    reader: PmTilesReader;
}
export interface PmTilesTileSource {
    /** Bytes for a tile, or `null` when the archive has no tile there. */
    getTile: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Uint8Array | null>;
}
/**
 * Wrap a PMTiles reader as a tile source that never throws.
 *
 * A missing tile and a failed read both resolve to `null`: an overlay draws
 * nothing rather than tearing down the map. Failures still reach `onError`,
 * so a caller can count them or surface a degraded state.
 */
export declare function createPmTilesTileSource(options: PmTilesTileSourceOptions): PmTilesTileSource;
export interface PmTilesFetchSourceOptions {
    /** Defaults to the global `fetch`; injected under test. */
    fetch?: typeof globalThis.fetch;
    /** Extra headers for every range request, for example an auth header. */
    headers?: Record<string, string>;
    url: string;
}
/**
 * A `pmtiles` `Source` backed by HTTP range requests.
 *
 * The package ships its own `FetchSource`, but it reads the global `fetch` and
 * carries retry behavior we don't want in a map tile path. This one takes the
 * `fetch` it uses, which is also what makes it testable without a network.
 */
export declare function createPmTilesFetchSource(options: PmTilesFetchSourceOptions): PmTilesSource;
//# sourceMappingURL=pmtiles.d.ts.map