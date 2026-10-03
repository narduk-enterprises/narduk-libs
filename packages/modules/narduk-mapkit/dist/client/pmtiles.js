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
/**
 * Wrap a PMTiles reader as a tile source that never throws.
 *
 * A missing tile and a failed read both resolve to `null`: an overlay draws
 * nothing rather than tearing down the map. Failures still reach `onError`,
 * so a caller can count them or surface a degraded state. A read cancelled
 * through `signal` is the caller moving on, not a failure: it resolves to
 * `null` and is not reported.
 */
export function createPmTilesTileSource(options) {
    const { onError, reader } = options;
    let maxZoom = null;
    return {
        async getMaxZoom() {
            if (!reader.getHeader)
                return;
            maxZoom ??= (async () => {
                try {
                    // Called on the reader: `PMTiles.getHeader` reads its own cache
                    // through `this`, so a detached call throws and overzoom never starts.
                    const { maxZoom: deepest } = await reader.getHeader();
                    return Number.isFinite(deepest) ? deepest : undefined;
                }
                catch (reason) {
                    // Try again next time; a transient failure should not pin "no data".
                    maxZoom = null;
                    onError?.(reason);
                    return;
                }
            })();
            return maxZoom;
        },
        async getTile(z, x, y, signal) {
            try {
                const tile = await reader.getZxy(z, x, y, signal);
                if (!tile?.data)
                    return null;
                return new Uint8Array(tile.data);
            }
            catch (reason) {
                if (signal?.aborted)
                    return null;
                onError?.(reason);
                return null;
            }
        },
    };
}
/**
 * A `pmtiles` `Source` backed by HTTP range requests.
 *
 * The package ships its own `FetchSource`, but it reads the global `fetch` and
 * carries retry behavior we don't want in a map tile path. This one takes the
 * `fetch` it uses, which is also what makes it testable without a network.
 */
export function createPmTilesFetchSource(options) {
    const { fetch: fetchImpl = globalThis.fetch, headers = {}, url } = options;
    if (!url.trim())
        throw new Error('pmtiles url is required');
    return {
        async getBytes(offset, length, signal, etag) {
            const response = await fetchImpl(url, {
                headers: {
                    ...headers,
                    range: `bytes=${offset}-${offset + length - 1}`,
                    ...(etag ? { 'if-match': etag } : {}),
                },
                ...(signal ? { signal } : {}),
            });
            if (!response.ok && response.status !== 206) {
                throw new Error(`pmtiles range request failed: ${response.status}`);
            }
            const cacheControl = response.headers.get('cache-control');
            const responseEtag = response.headers.get('etag');
            const expires = response.headers.get('expires');
            return {
                data: await response.arrayBuffer(),
                ...(cacheControl ? { cacheControl } : {}),
                ...(responseEtag ? { etag: responseEtag } : {}),
                ...(expires ? { expires } : {}),
            };
        },
        getKey() {
            return url;
        },
    };
}
//# sourceMappingURL=pmtiles.js.map