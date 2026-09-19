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
/** Int16 range, the bound {@link buildDecodedVectorTile} clamps coordinates to. */
const COORDINATE_MIN = -32_768;
const COORDINATE_MAX = 32_767;
/**
 * Pack features into the columnar layout {@link DecodedVectorTile} holds.
 *
 * Coordinates are clamped into the `Int16Array` range. In a tile whose extent
 * is 4096 that bound is eight tile widths away from the tile, so a clamped
 * point is far outside the canvas either way and the clamp cannot change a
 * pixel -- it only stops a wildly out-of-range producer from wrapping a line
 * back across the tile.
 *
 * A line of fewer than two points is dropped: it can't be stroked, and keeping
 * it would put empty ranges in `lineStarts` for the painter to skip.
 */
export function buildDecodedVectorTile(extent, features) {
    let pointCount = 0;
    let lineCount = 0;
    for (const feature of features) {
        for (const line of feature.lines) {
            if (line.length < 2)
                continue;
            lineCount += 1;
            pointCount += line.length;
        }
    }
    const coordinates = new Int16Array(pointCount * 2);
    const lineStarts = new Uint32Array(lineCount + 1);
    const featureLines = new Uint32Array(features.length + 1);
    const properties = [];
    let pointIndex = 0;
    let lineIndex = 0;
    let featureIndex = 0;
    for (const feature of features) {
        featureLines[featureIndex] = lineIndex;
        for (const line of feature.lines) {
            if (line.length < 2)
                continue;
            lineStarts[lineIndex] = pointIndex;
            lineIndex += 1;
            for (const point of line) {
                coordinates[pointIndex * 2] = clampCoordinate(point.x);
                coordinates[pointIndex * 2 + 1] = clampCoordinate(point.y);
                pointIndex += 1;
            }
        }
        properties.push(feature.properties);
        featureIndex += 1;
    }
    lineStarts[lineIndex] = pointIndex;
    featureLines[featureIndex] = lineIndex;
    return { coordinates, extent, featureLines, lineStarts, properties };
}
function clampCoordinate(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(COORDINATE_MAX, Math.max(COORDINATE_MIN, Math.round(value)));
}
/** Features in a decoded tile, which is one less than `featureLines.length`. */
export function vectorTileFeatureCount(tile) {
    return Math.max(0, tile.featureLines.length - 1);
}
/** Bytes a decoded tile retains, counting its arrays rather than its properties. */
export function decodedVectorTileBytes(tile) {
    return tile.coordinates.byteLength + tile.lineStarts.byteLength + tile.featureLines.byteLength;
}
/** Smallest LRU that does the job: Map preserves insertion order. */
class TileCache {
    #limit;
    #tiles = new Map();
    #bytes = 0;
    constructor(limit) {
        this.#limit = Math.max(1, limit);
    }
    get bytes() {
        return this.#bytes;
    }
    get size() {
        return this.#tiles.size;
    }
    clear() {
        this.#tiles.clear();
        this.#bytes = 0;
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
        this.#drop(key);
        this.#tiles.set(key, tile);
        this.#bytes += decodedVectorTileBytes(tile);
        while (this.#tiles.size > this.#limit) {
            const oldest = this.#tiles.keys().next().value;
            if (oldest === undefined)
                break;
            this.#drop(oldest);
        }
    }
    #drop(key) {
        const existing = this.#tiles.get(key);
        if (!existing)
            return;
        this.#bytes -= decodedVectorTileBytes(existing);
        this.#tiles.delete(key);
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
    const { coordinates, featureLines, lineStarts } = tile;
    let painted = false;
    for (let feature = 0; feature < featureLines.length - 1; feature += 1) {
        const properties = tile.properties[feature];
        if (!properties)
            continue;
        const paint = style(properties, zoom);
        if (!paint)
            continue;
        context.strokeStyle = paint.color;
        context.lineWidth = Math.max(paint.width * pixelRatio, pixelRatio * 0.5);
        context.globalAlpha = paint.opacity ?? 1;
        const lastLine = featureLines[feature + 1] ?? 0;
        for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
            const start = lineStarts[line] ?? 0;
            const end = lineStarts[line + 1] ?? start;
            if (end - start < 2)
                continue;
            context.beginPath();
            context.moveTo((coordinates[start * 2] ?? 0) * scale, (coordinates[start * 2 + 1] ?? 0) * scale);
            for (let point = start + 1; point < end; point += 1) {
                context.lineTo((coordinates[point * 2] ?? 0) * scale, (coordinates[point * 2 + 1] ?? 0) * scale);
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
        get cacheBytes() {
            return cache.bytes;
        },
        clearCache() {
            cache.clear();
        },
        async imageForTile(x, y, z, scale) {
            try {
                const tile = await decodedTile(z, x, y);
                if (!tile || vectorTileFeatureCount(tile) === 0)
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