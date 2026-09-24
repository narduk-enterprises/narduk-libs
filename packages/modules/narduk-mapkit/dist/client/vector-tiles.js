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
import { hitTestNeighbours, hitTestTile, projectToTilePoint } from './hit-test.js';
/** A fingertip, not a pixel. */
const DEFAULT_HIT_TOLERANCE_PX = 8;
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
/**
 * Bytes a decoded tile retains.
 *
 * Geometry and indexes are exact. Properties are estimated, because they are
 * ordinary objects and only the engine knows their real footprint -- but
 * leaving them out would understate a dense archive badly, since a `name`
 * string on each of a few thousand features per tile is what actually grows
 * the cache. The estimate charges two bytes per character of every key and
 * string value, eight for a number, and a flat per-entry overhead; it is
 * meant for sizing `cacheSize` against a budget, not for exact accounting.
 */
export function decodedVectorTileBytes(tile) {
    return (tile.coordinates.byteLength +
        tile.lineStarts.byteLength +
        tile.featureLines.byteLength +
        estimatePropertyBytes(tile.properties));
}
/** Per property entry: a key slot, a value slot and the map overhead around them. */
const PROPERTY_ENTRY_OVERHEAD = 32;
function estimatePropertyBytes(properties) {
    let bytes = 0;
    for (const entry of properties) {
        for (const key in entry) {
            const value = entry[key];
            bytes += PROPERTY_ENTRY_OVERHEAD + key.length * 2;
            if (typeof value === 'string')
                bytes += value.length * 2;
            else if (typeof value === 'number')
                bytes += 8;
        }
    }
    return bytes;
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
    // MapKit asks for a screenful at once and re-asks on every render pass, so
    // the same address is commonly requested again while its first read is
    // still in flight. Without this the archive is fetched twice and the tile
    // decoded twice, for one tile drawn.
    const inFlight = new Map();
    // Bumped by clearCache. A read started against the previous archive must
    // not land in the cache afterwards, and it cannot be cancelled, so it is
    // stamped with the generation it belongs to and discarded if that moved.
    let generation = 0;
    let style = options.style;
    async function readTile(key, z, x, y, startedAt) {
        const bytes = await tileBytes(z, x, y);
        if (!bytes)
            return null;
        const tile = await decode(bytes, { x, y, z });
        if (!tile)
            return null;
        if (startedAt === generation)
            cache.set(key, tile);
        return tile;
    }
    function decodedTile(z, x, y) {
        const key = `${z}/${x}/${y}`;
        const cached = cache.get(key);
        if (cached)
            return Promise.resolve(cached);
        const existing = inFlight.get(key);
        if (existing)
            return existing;
        const startedAt = generation;
        const started = readTile(key, z, x, y, startedAt).finally(() => {
            // Only if it is still this read: clearCache may have dropped the entry
            // and a newer read may already own the key.
            if (inFlight.get(key) === started)
                inFlight.delete(key);
        });
        inFlight.set(key, started);
        return started;
    }
    return {
        get cacheBytes() {
            return cache.bytes;
        },
        clearCache() {
            cache.clear();
            generation += 1;
            inFlight.clear();
        },
        hitTest({ coordinate, tolerancePx = DEFAULT_HIT_TOLERANCE_PX, zoom }) {
            // Everything is computed in tile fractions and converted per tile, so a
            // source whose tiles use different extents still compares like for like.
            const point = projectToTilePoint(coordinate, zoom, 1);
            const tolerance = tolerancePx / tileSize;
            let best = null;
            for (const candidate of hitTestNeighbours(point, zoom, 1, tolerance)) {
                const tile = cache.get(`${zoom}/${candidate.offsetX}/${candidate.offsetY}`);
                if (!tile)
                    continue;
                const hit = hitTestTile(tile, candidate.x * tile.extent, candidate.y * tile.extent, tolerance * tile.extent);
                if (!hit)
                    continue;
                const distancePx = (hit.distance / tile.extent) * tileSize;
                if (best && best.distancePx <= distancePx)
                    continue;
                best = {
                    distancePx,
                    feature: hit.feature,
                    properties: tile.properties[hit.feature] ?? {},
                    tile: { x: candidate.offsetX, y: candidate.offsetY, z: zoom },
                };
            }
            return best;
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