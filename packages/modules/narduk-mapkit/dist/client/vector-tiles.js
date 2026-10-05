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
import { DEFAULT_MOUSE_HIT_TOLERANCE_PX, hitTestNeighbours, hitTestTile, projectToTilePoint, } from './hit-test.js';
import { paintVectorTileAreas, vectorTileAreasReach } from './vector-tile-areas.js';
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
/** A painter could not take a request; the overlay paints it on the main thread. */
export class VectorTilePaintUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VectorTilePaintUnavailableError';
    }
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
/**
 * Default decoded-tile budget, in bytes.
 *
 * A dense river-network tile (about 10^5 points and a couple of thousand
 * features) retains roughly 0.7 MB by {@link decodedVectorTileBytes}; 64 MiB
 * holds on the order of ninety of them, several screens of a phone map plus the
 * ring MapKit prefetches, and a third of what the old 256-tile count cap would
 * have kept for the same tiles. See the measurement in the pull request that
 * introduced it (narduk-libs#1345 L6) and the README. Pass `cacheBytes:
 * Infinity` to cap by count only.
 */
export const DEFAULT_VECTOR_TILE_CACHE_BYTES = 64 * 1024 * 1024;
/**
 * LRU over decoded tiles, capped by count and by total decoded bytes.
 *
 * Map preserves insertion order, so the first key is the least recently used.
 * A tile larger than the whole byte budget is not retained at all -- keeping it
 * would evict everything else for one tile -- but the caller still has it in
 * hand to paint.
 *
 * Exported for the worker half of the paint protocol, which keeps its own
 * copy of the tiles it paints under the same rules.
 */
export class DecodedVectorTileCache {
    #byteLimit;
    #limit;
    #tiles = new Map();
    #bytes = 0;
    constructor(limit, byteLimit) {
        this.#limit = Math.max(1, limit);
        this.#byteLimit = Number.isNaN(byteLimit) ? Number.POSITIVE_INFINITY : Math.max(0, byteLimit);
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
        const entry = this.#tiles.get(key);
        if (!entry)
            return null;
        this.#tiles.delete(key);
        this.#tiles.set(key, entry);
        return entry.tile;
    }
    set(key, tile) {
        this.#drop(key);
        const bytes = decodedVectorTileBytes(tile);
        if (bytes > this.#byteLimit)
            return;
        this.#tiles.set(key, { bytes, tile });
        this.#bytes += bytes;
        while (this.#tiles.size > this.#limit || this.#bytes > this.#byteLimit) {
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
        this.#bytes -= existing.bytes;
        this.#tiles.delete(key);
    }
}
export const DEFAULT_VECTOR_TILE_CLASS_ZOOM_THRESHOLD = 8;
/** Reads in flight at once unless `readConcurrency` says otherwise. */
export const DEFAULT_VECTOR_TILE_READ_CONCURRENCY = 6;
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
/** The thinnest stroke the painter puts on the canvas, in device pixels. */
export const VECTOR_TILE_MIN_DEVICE_WIDTH = 1;
/**
 * A stroke width in device pixels, as the canvas should draw it.
 *
 * A line asked for under one device pixel is drawn one device pixel wide and
 * proportionally fainter, so a 0.3 CSS px hairline on a 3x screen is a crisp
 * 1 px line at 90% of its opacity rather than a 1.5 px one (the old floor was
 * half a CSS pixel, which made a 3x screen's hairlines thicker than asked).
 * Sub-pixel strokes are what a canvas antialiases into a grey grid; one solid
 * device pixel with the coverage moved into alpha draws the same ink, crisp.
 */
export function hairlineStroke(deviceWidth) {
    if (!(deviceWidth > 0))
        return { alpha: 0, width: VECTOR_TILE_MIN_DEVICE_WIDTH };
    if (deviceWidth >= VECTOR_TILE_MIN_DEVICE_WIDTH)
        return { alpha: 1, width: deviceWidth };
    return { alpha: deviceWidth / VECTOR_TILE_MIN_DEVICE_WIDTH, width: VECTOR_TILE_MIN_DEVICE_WIDTH };
}
function overzoomView(overzoom, extent, tileSize, pixelRatio, marginPx) {
    const span = extent / 2 ** overzoom.levels;
    const originX = overzoom.column * span;
    const originY = overzoom.row * span;
    const scale = (tileSize * pixelRatio) / span;
    const margin = marginPx / scale;
    return {
        originX,
        originY,
        scale,
        x0: originX - margin,
        x1: originX + span + margin,
        y0: originY - margin,
        y1: originY + span + margin,
    };
}
/**
 * Clip the segment `a -> b` to the view window (Liang-Barsky). Returns the
 * parameter range `[t0, t1]` that lies inside, or `null` if none does.
 */
function clipSegment(view, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const edges = [
        [-dx, ax - view.x0],
        [dx, view.x1 - ax],
        [-dy, ay - view.y0],
        [dy, view.y1 - ay],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0)
                return null;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1)
                return null;
            if (t > t0)
                t0 = t;
        }
        else {
            if (t < t0)
                return null;
            if (t < t1)
                t1 = t;
        }
    }
    return [t0, t1];
}
/**
 * Like {@link appendFeaturePath}, for a child of the decoded tile: points are
 * moved into the child's pixel frame and each line is cut to the child's
 * window, so a river that crosses the edge ends there instead of running off
 * to coordinates the canvas has to clip.
 */
function appendOverzoomFeaturePath(context, tile, feature, view) {
    const { coordinates, featureLines, lineStarts } = tile;
    const lastLine = featureLines[feature + 1] ?? 0;
    const { originX, originY, scale } = view;
    let added = false;
    for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
        const start = lineStarts[line] ?? 0;
        const end = lineStarts[line + 1] ?? start;
        let open = false;
        for (let point = start; point + 1 < end; point += 1) {
            const ax = coordinates[point * 2] ?? 0;
            const ay = coordinates[point * 2 + 1] ?? 0;
            const bx = coordinates[point * 2 + 2] ?? 0;
            const by = coordinates[point * 2 + 3] ?? 0;
            const range = clipSegment(view, ax, ay, bx, by);
            if (!range) {
                open = false;
                continue;
            }
            const [t0, t1] = range;
            if (!open || t0 > 0) {
                context.moveTo((ax + (bx - ax) * t0 - originX) * scale, (ay + (by - ay) * t0 - originY) * scale);
            }
            context.lineTo((ax + (bx - ax) * t1 - originX) * scale, (ay + (by - ay) * t1 - originY) * scale);
            open = t1 === 1;
            added = true;
        }
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
    const { areas, overzoom, pixelRatio, style, tileNetwork, tileSize, zoom } = options;
    const scale = (tileSize * pixelRatio) / tile.extent;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const areasPainted = areas
        ? paintVectorTileAreas(canvas, areas.layer, { pixelRatio, tile: areas.tile, tileSize })
        : false;
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
    let painted = areasPainted;
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
        const paint = head.paint;
        const view = overzoom
            ? overzoomView(overzoom, tile.extent, tileSize, pixelRatio, (paint.width + (paint.casing?.extraWidth ?? 0)) * pixelRatio)
            : null;
        for (const entry of batch) {
            const appended = view
                ? appendOverzoomFeaturePath(context, tile, entry.feature, view)
                : appendFeaturePath(context, tile, entry.feature, scale);
            if (appended)
                added = true;
        }
        if (!added)
            continue;
        const opacity = paint.opacity ?? 1;
        if (paint.casing) {
            const casing = hairlineStroke((paint.width + paint.casing.extraWidth) * pixelRatio);
            context.globalAlpha = opacity * casing.alpha;
            context.strokeStyle = paint.casing.color;
            context.lineWidth = casing.width;
            context.stroke();
        }
        const line = hairlineStroke(paint.width * pixelRatio);
        context.globalAlpha = opacity * line.alpha;
        context.strokeStyle = paint.color;
        context.lineWidth = line.width;
        context.stroke();
        painted = true;
    }
    context.globalAlpha = 1;
    return painted;
}
/**
 * Paint the pieces of one decoded tile whose `si` equals `id`, in one style.
 *
 * The highlight's counterpart to {@link paintVectorTile}, over the same
 * geometry and the same overzoom window, so a highlighted stretch lies exactly
 * on the line under it. A tile with no `si` column, or no matching feature,
 * paints nothing and returns `false`.
 */
export function paintVectorTileHighlight(canvas, tile, options) {
    const { id, overzoom, pixelRatio, style, tileSize } = options;
    const column = tile.si;
    if (!column || id === VECTOR_TILE_MISSING_ID)
        return false;
    const context = canvas.getContext('2d');
    if (!context)
        return false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const view = overzoom
        ? overzoomView(overzoom, tile.extent, tileSize, pixelRatio, (style.width + (style.casing?.extraWidth ?? 0)) * pixelRatio)
        : null;
    const scale = (tileSize * pixelRatio) / tile.extent;
    context.beginPath();
    let added = false;
    const featureCount = vectorTileFeatureCount(tile);
    for (let feature = 0; feature < featureCount; feature += 1) {
        if (column[feature] !== id)
            continue;
        const appended = view
            ? appendOverzoomFeaturePath(context, tile, feature, view)
            : appendFeaturePath(context, tile, feature, scale);
        if (appended)
            added = true;
    }
    if (!added)
        return false;
    context.globalAlpha = style.opacity ?? 1;
    if (style.casing) {
        context.strokeStyle = style.casing.color;
        context.lineWidth = Math.max((style.width + style.casing.extraWidth) * pixelRatio, pixelRatio * 0.5);
        context.stroke();
    }
    context.strokeStyle = style.color;
    context.lineWidth = Math.max(style.width * pixelRatio, pixelRatio * 0.5);
    context.stroke();
    context.globalAlpha = 1;
    return true;
}
/**
 * Paint a highlight plan over one decoded tile: every piece the plan strokes,
 * batched by style into one path per stroke, layers in order.
 *
 * The plan counterpart of {@link paintVectorTileHighlight}, over the same
 * geometry and overzoom window. A tile with no `si` column, or none the plan
 * strokes, paints nothing and returns `false`.
 */
export function paintVectorTileHighlightPlan(canvas, tile, options) {
    const { overzoom, pixelRatio, plan, tileSize, zoom } = options;
    const column = tile.si;
    if (!column)
        return false;
    const context = canvas.getContext('2d');
    if (!context)
        return false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const batches = new Map();
    const featureCount = vectorTileFeatureCount(tile);
    for (let feature = 0; feature < featureCount; feature += 1) {
        const si = column[feature];
        if (si === undefined || si === VECTOR_TILE_MISSING_ID)
            continue;
        const order = tile.so?.[feature] ?? 0;
        const answer = plan.strokes(si, order, zoom);
        if (!answer)
            continue;
        const strokes = Array.isArray(answer)
            ? answer
            : [answer];
        for (const stroke of strokes) {
            const layer = stroke.layer ?? 0;
            const key = `${layer}|${order}|${batchKey({ ...stroke, severity: 0 })}`;
            let batch = batches.get(key);
            if (!batch) {
                batch = { features: [], layer, order, stroke };
                batches.set(key, batch);
            }
            batch.features.push(feature);
        }
    }
    if (batches.size === 0)
        return false;
    const scale = (tileSize * pixelRatio) / tile.extent;
    let painted = false;
    const ordered = [...batches.values()].sort((left, right) => left.layer - right.layer || left.order - right.order);
    for (const { features, stroke } of ordered) {
        const view = overzoom
            ? overzoomView(overzoom, tile.extent, tileSize, pixelRatio, (stroke.width + (stroke.casing?.extraWidth ?? 0)) * pixelRatio)
            : null;
        context.beginPath();
        let added = false;
        for (const feature of features) {
            const appended = view
                ? appendOverzoomFeaturePath(context, tile, feature, view)
                : appendFeaturePath(context, tile, feature, scale);
            if (appended)
                added = true;
        }
        if (!added)
            continue;
        const opacity = stroke.opacity ?? 1;
        if (stroke.casing) {
            const casing = hairlineStroke((stroke.width + stroke.casing.extraWidth) * pixelRatio);
            context.globalAlpha = opacity * casing.alpha;
            context.strokeStyle = stroke.casing.color;
            context.lineWidth = casing.width;
            context.stroke();
        }
        const line = hairlineStroke(stroke.width * pixelRatio);
        context.globalAlpha = opacity * line.alpha;
        context.strokeStyle = stroke.color;
        context.lineWidth = line.width;
        context.stroke();
        painted = true;
    }
    context.globalAlpha = 1;
    return painted;
}
function normaliseMaxDataZoom(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return undefined;
    return Math.floor(value);
}
/** Tiles the highlight overlay may be waiting on at once; the oldest is forgotten past it. */
const MAX_HIGHLIGHT_MISSES = 1024;
/**
 * Quiet time after the last tile request before tiles dropped for a zoom
 * change are asked for again. A gesture asks every frame, so this fires once
 * the zoom has settled, not between frames.
 */
export const VECTOR_TILE_DROP_REFRESH_MS = 300;
const DEFAULT_RESTYLE_REPLACE = {
    activateWhen: 'first-image',
    crossfadeDurationMs: 0,
};
/**
 * Build the `imageForTile` function for a vector tile archive.
 *
 * An empty tile, a missing tile and a failed decode all resolve to `null`, so
 * MapKit draws nothing there instead of a blank square over the basemap.
 *
 * Reads go through a bounded queue (`readConcurrency`) served newest first. A
 * read for a zoom the map has since left is dropped before it starts, or
 * aborted through the `AbortSignal` handed to `tileBytes` if it already has.
 * Either way the tile resolves to `null`, is not reported to `onError`, is not
 * cached, and loads normally if it is asked for again.
 *
 * MapKit keeps that `null` as an empty tile and does not ask again, so a zoom
 * that comes back, or requests that alternate between two zooms, would leave
 * blank tiles. Once requests have been quiet for
 * {@link VECTOR_TILE_DROP_REFRESH_MS} after any drop, the overlay is swapped
 * through `restyleHost` (after the new overlay's first image, as a restyle is),
 * so every displayed tile is asked for again from the decoded cache.
 *
 * Above `maxDataZoom` a tile is painted from its ancestor at that zoom: one
 * read and one decode, shared by every descendant through the cache.
 */
export function createVectorTileOverlaySource(options) {
    const { archive, cacheBytes: byteBudget = DEFAULT_VECTOR_TILE_CACHE_BYTES, cacheSize = 256, createCanvas, decode, onError, painter, tileBytes, tileSize = 256, } = options;
    const concurrency = Math.max(1, Math.floor(options.readConcurrency ?? DEFAULT_VECTOR_TILE_READ_CONCURRENCY) || 1);
    const cache = new DecodedVectorTileCache(cacheSize, byteBudget);
    // MapKit asks for a screenful at once and re-asks on every render pass, so
    // the same address is commonly requested again while its first read is
    // still in flight. Without this the archive is fetched twice and the tile
    // decoded twice, for one tile drawn.
    const inFlight = new Map();
    // Reads wait here when `concurrency` are already running. Newest on top: the
    // tile the user is looking at now is the last one MapKit asked for.
    const queued = [];
    const running = new Set();
    // The zoom MapKit asked for most recently. A read for a zoom the map has
    // left is dropped (if queued) or aborted (if running).
    let latestZoom = null;
    // Bumped by clearCache. A read started against the previous archive must
    // not land in the cache afterwards, so it is stamped with the generation it
    // belongs to and discarded if that moved.
    let generation = 0;
    let style = options.style;
    let classTable = isVectorTileClassStyle(options.style) ? options.style.classTable : null;
    let restyleHost = options.restyleHost ?? null;
    let areas = options.areas ?? null;
    let highlight = null;
    let highlightPlan = null;
    let highlightHost = options.highlightHost ?? null;
    // Tiles the highlight overlay asked for before they were decoded. When one
    // lands, the highlight overlay is refreshed so its piece appears.
    const highlightMissed = new Set();
    const tileNetwork = options.tileNetwork;
    let restyleQueued = 0;
    let restyleApplied = 0;
    let restylePumping = false;
    const restyleWaiters = [];
    // The deepest zoom with data. `undefined` once settled means there is none.
    let maxDataZoom = normaliseMaxDataZoom(options.maxDataZoom);
    let maxDataZoomPending = null;
    if (maxDataZoom === undefined && options.maxDataZoom === undefined && archive?.getMaxZoom) {
        maxDataZoomPending = (async () => {
            try {
                maxDataZoom = normaliseMaxDataZoom(await archive.getMaxZoom?.());
            }
            catch {
                // No answer is no overzoom; the tile reads report their own failures.
            }
            finally {
                maxDataZoomPending = null;
            }
        })();
    }
    function dataZoomFor(zoom) {
        return maxDataZoom !== undefined && zoom > maxDataZoom ? maxDataZoom : zoom;
    }
    // One object per style change, not per tile: a painter keys what it has
    // already sent to its worker by identity, and a fresh spread per tile would
    // resend the whole class table with every tile.
    let live = null;
    function liveStyle() {
        if (live)
            return live;
        live = isVectorTileClassStyle(style) && classTable ? { ...style, classTable } : style;
        return live;
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
    function isStale(read) {
        return latestZoom !== null && read.z !== dataZoomFor(latestZoom);
    }
    /** Forget a read that will not complete, so the next ask starts a fresh one. */
    function release(read) {
        if (inFlight.get(read.key) === read)
            inFlight.delete(read.key);
    }
    // Reads dropped or aborted since the overlay was last refreshed for them.
    let dropped = 0;
    let dropRefresh = null;
    /** (Re)start the quiet timer after which dropped tiles are asked for again. */
    function armDropRefresh() {
        if (dropRefresh !== null)
            clearTimeout(dropRefresh);
        dropRefresh = setTimeout(() => {
            dropRefresh = null;
            if (dropped === 0)
                return;
            dropped = 0;
            if (restyleHost)
                void requestRestyle().catch((reason) => onError?.(reason));
        }, VECTOR_TILE_DROP_REFRESH_MS);
    }
    function noteDrop(read) {
        release(read);
        dropped += 1;
        armDropRefresh();
    }
    /** Drop what is queued for a zoom the map has left; abort what is running. */
    function dropStale() {
        for (let index = queued.length - 1; index >= 0; index -= 1) {
            const read = queued[index];
            if (!read || !isStale(read))
                continue;
            queued.splice(index, 1);
            noteDrop(read);
            read.settle(null);
        }
        for (const read of running) {
            if (!isStale(read))
                continue;
            noteDrop(read);
            read.controller.abort();
        }
    }
    function pump() {
        while (running.size < concurrency) {
            const read = queued.pop();
            if (!read)
                return;
            if (isStale(read)) {
                noteDrop(read);
                read.settle(null);
                continue;
            }
            running.add(read);
            read.settle(execute(read));
        }
    }
    async function execute(read) {
        const { controller, generation: startedAt, key, x, y, z } = read;
        let bytes;
        try {
            bytes = await tileBytes(z, x, y, controller.signal);
        }
        catch (reason) {
            // An aborted read is the map moving on, not a failure.
            if (controller.signal.aborted)
                return null;
            throw reason;
        }
        finally {
            running.delete(read);
            pump();
        }
        if (controller.signal.aborted || !bytes)
            return null;
        const tile = await decode(bytes, { x, y, z });
        if (!tile)
            return null;
        if (startedAt === generation) {
            cache.set(key, tile);
            if (highlightMissed.delete(key))
                void refreshHighlight().catch((reason) => onError?.(reason));
        }
        return tile;
    }
    function decodedTile(z, x, y) {
        const key = `${z}/${x}/${y}`;
        const cached = cache.get(key);
        if (cached)
            return Promise.resolve(cached);
        const existing = inFlight.get(key);
        if (existing)
            return existing.promise;
        let settle;
        const read = {
            controller: new AbortController(),
            generation,
            key,
            promise: new Promise((resolve) => {
                settle = resolve;
            }),
            settle: (value) => settle(value),
            x,
            y,
            z,
        };
        // Only if it is still this read: clearCache may have dropped the entry
        // and a newer read may already own the key.
        void read.promise.then(() => release(read), () => release(read));
        inFlight.set(key, read);
        queued.push(read);
        pump();
        return read.promise;
    }
    async function imageForTile(x, y, z, scale) {
        try {
            if (maxDataZoomPending)
                await maxDataZoomPending;
            latestZoom = z;
            // Still asking: the zoom has not settled, so hold the refresh back.
            if (dropped > 0)
                armDropRefresh();
            dropStale();
            // Above the archive's last zoom the data lives in one ancestor, shared
            // by every descendant through the cache.
            const levels = z - dataZoomFor(z);
            const factor = 2 ** levels;
            const ancestorX = Math.floor(x / factor);
            const ancestorY = Math.floor(y / factor);
            const tile = await decodedTile(z - levels, ancestorX, ancestorY);
            const hasLines = tile !== null && vectorTileFeatureCount(tile) > 0;
            // Areas go under the lines in the same image. A tile they do not reach is
            // painted exactly as it was without them.
            const address = { x, y, z };
            const layer = areas;
            const underlay = layer !== null && vectorTileAreasReach(layer, address, tileSize);
            if (!hasLines && !underlay)
                return null;
            const pixelRatio = scale > 0 ? scale : 1;
            const size = Math.round(tileSize * pixelRatio);
            const areaOptions = { pixelRatio, tile: address, tileSize };
            if (!tile || !hasLines) {
                // Nothing to draw but the areas: the archive holds no lines for this tile.
                const canvas = createCanvas(size, size);
                return layer && paintVectorTileAreas(canvas, layer, areaOptions) ? canvas : null;
            }
            const request = {
                ...paintOptions(z),
                pixelRatio,
                ...(levels > 0
                    ? { overzoom: { column: x - ancestorX * factor, levels, row: y - ancestorY * factor } }
                    : {}),
            };
            const offThread = painter?.paint(tile, request) ?? null;
            if (offThread) {
                try {
                    const image = await offThread;
                    if (!underlay || !layer)
                        return image;
                    // The painter's lines go over the areas painted here.
                    const composed = createCanvas(size, size);
                    const context = composed.getContext('2d');
                    if (context?.drawImage) {
                        paintVectorTileAreas(composed, layer, areaOptions);
                        if (image)
                            context.drawImage(image, 0, 0);
                        return composed;
                    }
                    // A context that cannot compose: paint the whole tile here, below.
                }
                catch (reason) {
                    if (!(reason instanceof VectorTilePaintUnavailableError))
                        throw reason;
                    // Declined after the fact: paint it here, below.
                }
            }
            const canvas = createCanvas(size, size);
            const painted = paintVectorTile(canvas, tile, {
                ...request,
                ...(underlay && layer ? { areas: { layer, tile: address } } : {}),
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
    async function highlightImageForTile(x, y, z, scale) {
        try {
            if (!highlight && !highlightPlan)
                return null;
            if (maxDataZoomPending)
                await maxDataZoomPending;
            const levels = z - dataZoomFor(z);
            const factor = 2 ** levels;
            const ancestorX = Math.floor(x / factor);
            const ancestorY = Math.floor(y / factor);
            const key = `${z - levels}/${ancestorX}/${ancestorY}`;
            // Cache, or a read the base layer already started. Never a read of its own.
            let tile = cache.get(key);
            if (!tile) {
                try {
                    tile = (await inFlight.get(key)?.promise) ?? null;
                }
                catch {
                    // The base layer reports its own failed read.
                    tile = null;
                }
            }
            if (!tile) {
                highlightMissed.add(key);
                if (highlightMissed.size > MAX_HIGHLIGHT_MISSES) {
                    const oldest = highlightMissed.values().next().value;
                    if (oldest !== undefined)
                        highlightMissed.delete(oldest);
                }
                return null;
            }
            const current = highlight;
            const plan = highlightPlan;
            if (!current && !plan)
                return null;
            const pixelRatio = scale > 0 ? scale : 1;
            const size = Math.round(tileSize * pixelRatio);
            const canvas = createCanvas(size, size);
            const overzoom = levels > 0
                ? { column: x - ancestorX * factor, levels, row: y - ancestorY * factor }
                : undefined;
            const painted = plan
                ? paintVectorTileHighlightPlan(canvas, tile, {
                    pixelRatio,
                    plan,
                    tileSize,
                    zoom: z,
                    ...(overzoom ? { overzoom } : {}),
                })
                : current !== null &&
                    paintVectorTileHighlight(canvas, tile, {
                        id: current.id,
                        pixelRatio,
                        style: current.style,
                        tileSize,
                        ...(overzoom ? { overzoom } : {}),
                    });
            return painted ? canvas : null;
        }
        catch (reason) {
            onError?.(reason);
            return null;
        }
    }
    // Swaps only the highlight overlay. Coalesces a burst to the latest state.
    let highlightQueued = 0;
    let highlightApplied = 0;
    let highlightPumping = false;
    const highlightWaiters = [];
    function refreshHighlight() {
        const epoch = ++highlightQueued;
        const done = new Promise((resolve, reject) => {
            highlightWaiters.push({ epoch, reject, resolve });
        });
        void pumpHighlight();
        return done;
    }
    function settleHighlightWaiters(upTo, error) {
        for (let index = highlightWaiters.length - 1; index >= 0; index -= 1) {
            const waiter = highlightWaiters[index];
            if (!waiter || waiter.epoch > upTo)
                continue;
            highlightWaiters.splice(index, 1);
            if (error)
                waiter.reject(error);
            else
                waiter.resolve();
        }
    }
    async function pumpHighlight() {
        if (highlightPumping)
            return;
        highlightPumping = true;
        try {
            await Promise.resolve();
            while (highlightApplied !== highlightQueued) {
                const target = highlightQueued;
                const host = highlightHost;
                if (host) {
                    const descriptor = {
                        ...host.descriptor,
                        id: host.layerId,
                        imageForTile: highlightImageForTile,
                    };
                    await host.replace(host.layerId, descriptor, {
                        ...DEFAULT_RESTYLE_REPLACE,
                        // A cleared highlight has no first image to wait for.
                        ...(highlight || highlightPlan ? {} : { activateWhen: 'immediate' }),
                        ...host.replaceOptions,
                    });
                }
                highlightApplied = target;
                settleHighlightWaiters(target);
            }
        }
        catch (reason) {
            settleHighlightWaiters(highlightQueued, reason);
            highlightApplied = highlightQueued;
        }
        finally {
            highlightPumping = false;
            if (highlightApplied !== highlightQueued)
                void pumpHighlight();
        }
    }
    function setHighlight(next) {
        if (next !== null && (!Number.isInteger(next.id) || next.id < 0)) {
            throw new RangeError('highlight id must be a non-negative integer');
        }
        highlight = next ? { id: next.id, style: next.style } : null;
        highlightPlan = null;
        highlightMissed.clear();
        return refreshHighlight();
    }
    function setHighlightPlan(next) {
        highlightPlan = next;
        highlight = null;
        highlightMissed.clear();
        return refreshHighlight();
    }
    function hitTestArea(coordinate) {
        const layer = areas;
        if (!layer)
            return null;
        return layer.index.hitTest(coordinate, (area) => layer.style(area) !== null);
    }
    function hitTestAreas(coordinate) {
        const layer = areas;
        if (!layer)
            return [];
        return layer.index.hitTestAll(coordinate, (area) => layer.style(area) !== null);
    }
    return {
        get areas() {
            return areas;
        },
        get cacheBytes() {
            return cache.bytes;
        },
        hitTestArea,
        hitTestAreas,
        setAreas(next) {
            areas = next;
            return requestRestyle();
        },
        clearHighlight() {
            return setHighlight(null);
        },
        get highlight() {
            return highlight;
        },
        get highlightPlan() {
            return highlightPlan;
        },
        highlightImageForTile,
        clearCache() {
            cache.clear();
            generation += 1;
            inFlight.clear();
        },
        hitTest({ accept, coordinate, rank, tolerancePx = DEFAULT_MOUSE_HIT_TOLERANCE_PX, zoom }) {
            // Everything is computed in tile fractions and converted per tile, so a
            // source whose tiles use different extents still compares like for like.
            // Above the data zoom the tiles are the ancestors', and a displayed tile
            // is `1 / 2 ** levels` of one, so a pixel is that much smaller a fraction.
            const dataZoom = dataZoomFor(zoom);
            const pixelsPerTile = tileSize * 2 ** (zoom - dataZoom);
            const point = projectToTilePoint(coordinate, dataZoom, 1);
            const tolerance = tolerancePx / pixelsPerTile;
            let best = null;
            let bestRank = Number.NEGATIVE_INFINITY;
            for (const candidate of hitTestNeighbours(point, dataZoom, 1, tolerance)) {
                const tile = cache.get(`${dataZoom}/${candidate.offsetX}/${candidate.offsetY}`);
                if (!tile)
                    continue;
                const select = accept || rank
                    ? {
                        accept: accept ? (feature) => accept(tile.properties[feature] ?? {}) : undefined,
                        rank: rank ? (feature) => rank(tile.properties[feature] ?? {}) : undefined,
                    }
                    : undefined;
                const hit = hitTestTile(tile, candidate.x * tile.extent, candidate.y * tile.extent, tolerance * tile.extent, select);
                if (!hit)
                    continue;
                const distancePx = (hit.distance / tile.extent) * pixelsPerTile;
                // Across the tiles a probe reaches, the same order: rank, then nearness.
                if (best &&
                    (hit.rank < bestRank || (hit.rank === bestRank && best.distancePx <= distancePx))) {
                    continue;
                }
                bestRank = hit.rank;
                best = {
                    distancePx,
                    feature: hit.feature,
                    properties: tile.properties[hit.feature] ?? {},
                    tile: { x: candidate.offsetX, y: candidate.offsetY, z: dataZoom },
                };
            }
            return best;
        },
        imageForTile,
        restyle(next) {
            style = next;
            classTable = isVectorTileClassStyle(next) ? next.classTable : classTable;
            live = null;
            return requestRestyle();
        },
        setClassTable(table) {
            classTable = table;
            if (isVectorTileClassStyle(style))
                style = { ...style, classTable: table };
            live = null;
            return requestRestyle();
        },
        setHighlight,
        setHighlightPlan,
        setHighlightHost(host) {
            highlightHost = host;
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
            live = null;
        },
    };
}
//# sourceMappingURL=vector-tiles.js.map