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
/** Smallest LRU that does the job: Map preserves insertion order. */
class TileCache {
    #limit;
    #tiles = new Map();
    constructor(limit) {
        this.#limit = Math.max(1, limit);
    }
    get size() {
        return this.#tiles.size;
    }
    clear() {
        this.#tiles.clear();
    }
    get(key) {
        const tile = this.#tiles.get(key);
        if (!tile)
            return null;
        this.#tiles.delete(key);
        this.#tiles.set(key, tile);
        return tile;
    }
    set(key, tile) {
        if (this.#tiles.has(key))
            this.#tiles.delete(key);
        this.#tiles.set(key, tile);
        while (this.#tiles.size > this.#limit) {
            const oldest = this.#tiles.keys().next().value;
            if (oldest === undefined)
                break;
            this.#tiles.delete(oldest);
        }
    }
}
/**
 * Paint one decoded tile. Exported because the hit-test and the overlay need
 * the same tile-to-pixel mapping, and a test can call it directly.
 */
export function paintVectorTile(canvas, tile, options) {
    const context = canvas.getContext('2d');
    if (!context)
        return false;
    const { pixelRatio, style, tileSize, zoom } = options;
    const scale = (tileSize * pixelRatio) / tile.extent;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    let painted = false;
    for (const feature of tile.features) {
        const paint = style(feature.properties, zoom);
        if (!paint)
            continue;
        context.strokeStyle = paint.color;
        context.lineWidth = Math.max(paint.width * pixelRatio, pixelRatio * 0.5);
        context.globalAlpha = paint.opacity ?? 1;
        for (const line of feature.geometry) {
            if (line.length < 2)
                continue;
            context.beginPath();
            let first = true;
            for (const point of line) {
                const x = point.x * scale;
                const y = point.y * scale;
                if (first) {
                    context.moveTo(x, y);
                    first = false;
                }
                else {
                    context.lineTo(x, y);
                }
            }
            context.stroke();
            painted = true;
        }
    }
    context.globalAlpha = 1;
    return painted;
}
/**
 * Build the `imageForTile` function for a vector tile archive.
 *
 * An empty tile, a missing tile and a failed decode all resolve to `null`, so
 * MapKit draws nothing there instead of a blank square over the basemap.
 */
export function createVectorTileOverlaySource(options) {
    const { cacheSize = 256, createCanvas, decode, onError, tileBytes, tileSize = 256 } = options;
    const cache = new TileCache(cacheSize);
    let style = options.style;
    async function decodedTile(z, x, y) {
        const key = `${z}/${x}/${y}`;
        const cached = cache.get(key);
        if (cached)
            return cached;
        const bytes = await tileBytes(z, x, y);
        if (!bytes)
            return null;
        const tile = await decode(bytes, { x, y, z });
        if (!tile)
            return null;
        cache.set(key, tile);
        return tile;
    }
    return {
        clearCache() {
            cache.clear();
        },
        async imageForTile(x, y, z, scale) {
            try {
                const tile = await decodedTile(z, x, y);
                if (!tile || tile.features.length === 0)
                    return null;
                const pixelRatio = scale > 0 ? scale : 1;
                const size = Math.round(tileSize * pixelRatio);
                const canvas = createCanvas(size, size);
                const painted = paintVectorTile(canvas, tile, {
                    pixelRatio,
                    style,
                    tileSize,
                    zoom: z,
                });
                return painted ? canvas : null;
            }
            catch (reason) {
                onError?.(reason);
                return null;
            }
        },
        get size() {
            return cache.size;
        },
        setStyle(next) {
            style = next;
        },
    };
}
//# sourceMappingURL=vector-tiles.js.map