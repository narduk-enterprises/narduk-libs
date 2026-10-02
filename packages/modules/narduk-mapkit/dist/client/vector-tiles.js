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
/**
 * Sentinel in `si` / `ri` columns when that feature did not carry the key.
 * A class-table lookup treats it as unknown, never as id 0.
 */
export const VECTOR_TILE_MISSING_ID = 0xffff_ffff;
/** Reserved class byte: a gauge is on this stretch but is not reporting. */
export const VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING = 254;
/**
 * Reserved class byte: no gauge on this stretch. Drawn in the style's
 * `noGauge` paint — a neutral water colour — not the unknown grey.
 */
export const VECTOR_TILE_CLASS_NO_GAUGE = 255;
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
 *
 * `so`, `si` and `ri` become typed columns when at least one feature carries
 * them. A missing id in an otherwise-present `si`/`ri` column is
 * {@link VECTOR_TILE_MISSING_ID}, so a class-table lookup cannot mistake it
 * for id 0.
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
    const so = new Uint8Array(features.length);
    const si = new Uint32Array(features.length);
    const ri = new Uint32Array(features.length);
    si.fill(VECTOR_TILE_MISSING_ID);
    ri.fill(VECTOR_TILE_MISSING_ID);
    let anySo = false;
    let anySi = false;
    let anyRi = false;
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
        const streamOrder = readColumnNumber(feature.so, feature.properties, 'so');
        if (streamOrder !== null) {
            anySo = true;
            so[featureIndex] = clampByte(streamOrder);
        }
        const segmentId = readColumnNumber(feature.si, feature.properties, 'si');
        if (segmentId !== null) {
            anySi = true;
            si[featureIndex] = toClassId(segmentId);
        }
        const reachId = readColumnNumber(feature.ri, feature.properties, 'ri');
        if (reachId !== null) {
            anyRi = true;
            ri[featureIndex] = toClassId(reachId);
        }
        featureIndex += 1;
    }
    lineStarts[lineIndex] = pointIndex;
    featureLines[featureIndex] = lineIndex;
    return {
        coordinates,
        extent,
        featureLines,
        lineStarts,
        properties,
        ...(anyRi ? { ri } : {}),
        ...(anySi ? { si } : {}),
        ...(anySo ? { so } : {}),
    };
}
function clampCoordinate(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(COORDINATE_MAX, Math.max(COORDINATE_MIN, Math.round(value)));
}
function clampByte(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(255, Math.max(0, Math.round(value)));
}
function toClassId(value) {
    if (!Number.isFinite(value) || value < 0)
        return VECTOR_TILE_MISSING_ID;
    return Math.min(VECTOR_TILE_MISSING_ID, Math.round(value));
}
function readColumnNumber(explicit, properties, key) {
    if (typeof explicit === 'number' && Number.isFinite(explicit))
        return explicit;
    const value = properties[key];
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return null;
}
/** Features in a decoded tile, which is one less than `featureLines.length`. */
export function vectorTileFeatureCount(tile) {
    return Math.max(0, tile.featureLines.length - 1);
}
export function isVectorTileClassStyle(style) {
    return typeof style === 'object' && style !== null && 'classTable' in style;
}
/**
 * Bytes a decoded tile retains.
 *
 * Geometry, indexes and class columns are exact. Properties are estimated,
 * because they are ordinary objects and only the engine knows their real
 * footprint -- but leaving them out would understate a dense archive badly,
 * since a `name` string on each of a few thousand features per tile is what
 * actually grows the cache. The estimate charges two bytes per character of
 * every key and string value, eight for a number, and a flat per-entry
 * overhead; it is meant for sizing `cacheSize` against a budget, not for
 * exact accounting.
 */
export function decodedVectorTileBytes(tile) {
    return (tile.coordinates.byteLength +
        tile.lineStarts.byteLength +
        tile.featureLines.byteLength +
        (tile.so?.byteLength ?? 0) +
        (tile.si?.byteLength ?? 0) +
        (tile.ri?.byteLength ?? 0) +
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
export const DEFAULT_VECTOR_TILE_CLASS_ZOOM_THRESHOLD = 8;
/**
 * Whether a class table may colour these tiles.
 *
 * The table's own `length` must equal `classes.length`. When a tile-network
 * identity is supplied it must also match the table's declared version and
 * length. Anything else is a different network, and the painter must not
 * guess.
 */
export function classTableMatchesNetwork(table, tileNetwork) {
    if (table.length !== table.classes.length)
        return false;
    if (!tileNetwork)
        return true;
    return table.networkVersion === tileNetwork.version && table.length === tileNetwork.length;
}
/** Which column a class-table style reads at `zoom`. */
export function vectorTileClassKeyAtZoom(style, zoom) {
    const threshold = style.zoomThreshold ?? DEFAULT_VECTOR_TILE_CLASS_ZOOM_THRESHOLD;
    return zoom < threshold ? (style.keyBelowZoom ?? 'si') : (style.keyFromZoom ?? 'ri');
}
/**
 * Class byte for one feature, or `null` when the chosen column is absent,
 * the id is missing, or the id sits outside the table.
 *
 * `null` is "no data", never 0 and never a reserved byte.
 */
export function vectorTileClassByte(tile, feature, key, table) {
    const column = key === 'si' ? tile.si : tile.ri;
    if (!column)
        return null;
    const id = column[feature];
    if (id === undefined || id === VECTOR_TILE_MISSING_ID)
        return null;
    if (id >= table.classes.length)
        return null;
    return table.classes[id] ?? null;
}
/**
 * Paint for a looked-up class byte. Reserved 254/255 and unknown stay
 * distinct from `paintByClass`, including from any entry at those indexes.
 */
export function paintForVectorTileClass(style, classByte, compatible) {
    let paint;
    if (!compatible || classByte === null)
        paint = style.unknown;
    else if (classByte === VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING)
        paint = style.gaugeNotReporting;
    else if (classByte === VECTOR_TILE_CLASS_NO_GAUGE)
        paint = style.noGauge;
    else
        paint = style.paintByClass[classByte] ?? style.unknown;
    const severity = paint.severity ??
        (compatible && classByte !== null && classByte < VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING
            ? classByte
            : -1);
    return withCasing({ ...paint, severity }, style.casing);
}
function withCasing(paint, fallback) {
    if (paint.casing || !fallback)
        return paint;
    return { ...paint, casing: fallback };
}
function resolveFeaturePaint(tile, feature, zoom, style, tileNetwork) {
    if (isVectorTileClassStyle(style)) {
        const compatible = classTableMatchesNetwork(style.classTable, tileNetwork ?? style.tileNetwork);
        const key = vectorTileClassKeyAtZoom(style, zoom);
        const classByte = compatible ? vectorTileClassByte(tile, feature, key, style.classTable) : null;
        return paintForVectorTileClass(style, classByte, compatible);
    }
    const properties = tile.properties[feature];
    if (!properties)
        return null;
    return style(properties, zoom);
}
function streamOrderOf(tile, feature, properties) {
    const column = tile.so?.[feature];
    if (column !== undefined)
        return column;
    const value = properties.so;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function severityOf(paint, properties) {
    if (typeof paint.severity === 'number' && Number.isFinite(paint.severity))
        return paint.severity;
    const value = properties.severity;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function batchKey(paint) {
    const casing = paint.casing;
    return [
        paint.color,
        String(paint.width),
        String(paint.opacity ?? 1),
        casing ? `${casing.color}:${casing.extraWidth}` : '',
    ].join('|');
}
function appendFeaturePath(context, tile, feature, scale) {
    const { coordinates, featureLines, lineStarts } = tile;
    const lastLine = featureLines[feature + 1] ?? 0;
    let added = false;
    for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
        const start = lineStarts[line] ?? 0;
        const end = lineStarts[line + 1] ?? start;
        if (end - start < 2)
            continue;
        context.moveTo((coordinates[start * 2] ?? 0) * scale, (coordinates[start * 2 + 1] ?? 0) * scale);
        for (let point = start + 1; point < end; point += 1) {
            context.lineTo((coordinates[point * 2] ?? 0) * scale, (coordinates[point * 2 + 1] ?? 0) * scale);
        }
        added = true;
    }
    return added;
}
/**
 * Paint one decoded tile. Exported because the hit-test and the overlay need
 * the same tile-to-pixel mapping, and a test can call it directly.
 *
 * Lines are grouped by colour and width into one stroke per batch, then
 * drawn in stream-order then severity so a flooded stretch sits on top of
 * the same-order water under it. An optional casing is the same path,
 * stroked wider, underneath the batch.
 */
export function paintVectorTile(canvas, tile, options) {
    const context = canvas.getContext('2d');
    if (!context)
        return false;
    const { pixelRatio, style, tileNetwork, tileSize, zoom } = options;
    const scale = (tileSize * pixelRatio) / tile.extent;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const featureCount = vectorTileFeatureCount(tile);
    const paintedFeatures = [];
    for (let feature = 0; feature < featureCount; feature += 1) {
        const paint = resolveFeaturePaint(tile, feature, zoom, style, tileNetwork);
        if (!paint)
            continue;
        const properties = tile.properties[feature] ?? {};
        paintedFeatures.push({
            feature,
            key: batchKey(paint),
            paint,
            severity: severityOf(paint, properties),
            so: streamOrderOf(tile, feature, properties),
        });
    }
    paintedFeatures.sort((left, right) => left.so - right.so || left.severity - right.severity);
    let painted = false;
    let index = 0;
    while (index < paintedFeatures.length) {
        const head = paintedFeatures[index];
        if (!head)
            break;
        const batch = [head];
        index += 1;
        while (index < paintedFeatures.length) {
            const next = paintedFeatures[index];
            if (!next || next.key !== head.key)
                break;
            batch.push(next);
            index += 1;
        }
        context.beginPath();
        let added = false;
        for (const entry of batch) {
            if (appendFeaturePath(context, tile, entry.feature, scale))
                added = true;
        }
        if (!added)
            continue;
        const paint = head.paint;
        context.globalAlpha = paint.opacity ?? 1;
        if (paint.casing) {
            context.strokeStyle = paint.casing.color;
            context.lineWidth = Math.max((paint.width + paint.casing.extraWidth) * pixelRatio, pixelRatio * 0.5);
            context.stroke();
        }
        context.strokeStyle = paint.color;
        context.lineWidth = Math.max(paint.width * pixelRatio, pixelRatio * 0.5);
        context.stroke();
        painted = true;
    }
    context.globalAlpha = 1;
    return painted;
}
const DEFAULT_RESTYLE_REPLACE = {
    activateWhen: 'first-image',
    crossfadeDurationMs: 0,
};
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
    let classTable = isVectorTileClassStyle(options.style) ? options.style.classTable : null;
    let restyleHost = options.restyleHost ?? null;
    const tileNetwork = options.tileNetwork;
    let restyleQueued = 0;
    let restyleApplied = 0;
    let restylePumping = false;
    const restyleWaiters = [];
    function liveStyle() {
        if (isVectorTileClassStyle(style) && classTable) {
            return { ...style, classTable };
        }
        return style;
    }
    function paintOptions(zoom) {
        return {
            pixelRatio: 1,
            style: liveStyle(),
            tileSize,
            zoom,
            ...(tileNetwork ? { tileNetwork } : {}),
        };
    }
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
    async function imageForTile(x, y, z, scale) {
        try {
            const tile = await decodedTile(z, x, y);
            if (!tile || vectorTileFeatureCount(tile) === 0)
                return null;
            const pixelRatio = scale > 0 ? scale : 1;
            const size = Math.round(tileSize * pixelRatio);
            const canvas = createCanvas(size, size);
            const painted = paintVectorTile(canvas, tile, {
                ...paintOptions(z),
                pixelRatio,
            });
            return painted ? canvas : null;
        }
        catch (reason) {
            onError?.(reason);
            return null;
        }
    }
    function requestRestyle() {
        const epoch = ++restyleQueued;
        const done = new Promise((resolve, reject) => {
            restyleWaiters.push({ epoch, reject, resolve });
        });
        void pumpRestyle();
        return done;
    }
    function settleWaiters(upTo, error) {
        const remaining = [];
        for (const waiter of restyleWaiters) {
            if (waiter.epoch > upTo) {
                remaining.push(waiter);
                continue;
            }
            if (error)
                waiter.reject(error);
            else
                waiter.resolve();
        }
        restyleWaiters.length = 0;
        restyleWaiters.push(...remaining);
    }
    async function pumpRestyle() {
        if (restylePumping)
            return;
        restylePumping = true;
        try {
            // Collapse a same-turn burst (lens + theme + table) to one swap.
            await Promise.resolve();
            while (restyleApplied !== restyleQueued) {
                const target = restyleQueued;
                const host = restyleHost;
                if (host) {
                    const descriptor = {
                        ...host.descriptor,
                        id: host.layerId,
                        imageForTile,
                    };
                    await host.replace(host.layerId, descriptor, {
                        ...DEFAULT_RESTYLE_REPLACE,
                        ...host.replaceOptions,
                    });
                }
                restyleApplied = target;
                settleWaiters(target);
            }
        }
        catch (reason) {
            settleWaiters(restyleQueued, reason);
            restyleApplied = restyleQueued;
        }
        finally {
            restylePumping = false;
            if (restyleApplied !== restyleQueued)
                void pumpRestyle();
        }
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
        imageForTile,
        restyle(next) {
            style = next;
            classTable = isVectorTileClassStyle(next) ? next.classTable : classTable;
            return requestRestyle();
        },
        setClassTable(table) {
            classTable = table;
            if (isVectorTileClassStyle(style))
                style = { ...style, classTable: table };
            return requestRestyle();
        },
        setRestyleHost(host) {
            restyleHost = host;
        },
        get size() {
            return cache.size;
        },
        setStyle(next) {
            style = next;
            if (isVectorTileClassStyle(next))
                classTable = next.classTable;
        },
    };
}
//# sourceMappingURL=vector-tiles.js.map