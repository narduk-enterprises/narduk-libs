/**
 * Areas under the lines.
 *
 * A national river map wants flood-alert shapes drawn beneath the river
 * network, so a stretch inside a warning still reads as a river. MapKit JS has
 * no layer order between its vector overlays and a tile overlay that an app can
 * rely on, so this paints the shapes into the same tile image as the network,
 * first, and the lines go on top. The same shapes answer "what area is under
 * this point?" for a tap, from memory, with no map in the way.
 *
 * An area is a GeoJSON Polygon or MultiPolygon with an id, a priority and
 * whatever the app wants carried with it. {@link createVectorTileAreaIndex}
 * projects every vertex to Web Mercator once; painting a tile is then a scale
 * and a subtraction per vertex, and a tile an area does not reach never looks
 * at its vertices at all.
 */
import { geoJsonFeatureToPolygonDrawables } from '../geometry/geometry.js';
/** Web Mercator's usable latitude range; beyond it the projection diverges. */
const MAX_LATITUDE = 85.051_128_779_806_59;
/** Where a stroke may reach past its shape's box, in device pixels, before a tile skips it. */
const STROKE_REACH_PX = 2;
/** A vertex closer than this to the one before it, in device pixels, is not drawn. */
const MIN_VERTEX_GAP_PX = 0.5;
/** Latitude in degrees to Web Mercator world y: 0 at the north edge, 1 at the south. */
function worldY(latitude) {
    const clamped = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, latitude));
    const radians = (clamped * Math.PI) / 180;
    return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}
function worldX(longitude) {
    return (longitude + 180) / 360;
}
function worldYToLatitude(y) {
    const n = Math.PI * (1 - 2 * y);
    return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}
function buildShape(rings) {
    let points = 0;
    for (const ring of rings)
        points += ring.length;
    const coordinates = new Float64Array(points * 2);
    const ringStarts = new Uint32Array(rings.length + 1);
    let west = Infinity;
    let north = Infinity;
    let east = -Infinity;
    let south = -Infinity;
    let cursor = 0;
    for (const [index, ring] of rings.entries()) {
        ringStarts[index] = cursor;
        for (const point of ring) {
            const x = worldX(point.lng);
            const y = worldY(point.lat);
            coordinates[cursor * 2] = x;
            coordinates[cursor * 2 + 1] = y;
            if (x < west)
                west = x;
            if (x > east)
                east = x;
            if (y < north)
                north = y;
            if (y > south)
                south = y;
            cursor += 1;
        }
    }
    ringStarts[rings.length] = cursor;
    return { box: [west, north, east, south], coordinates, ringStarts };
}
/** Even-odd containment across the rings of one shape: a point in a hole is outside. */
function shapeContains(shape, x, y) {
    const [west, north, east, south] = shape.box;
    if (x < west || x > east || y < north || y > south)
        return false;
    const { coordinates, ringStarts } = shape;
    let inside = false;
    for (let ring = 0; ring + 1 < ringStarts.length; ring += 1) {
        const start = ringStarts[ring] ?? 0;
        const end = ringStarts[ring + 1] ?? start;
        for (let current = start, previous = end - 1; current < end; previous = current, current += 1) {
            const cx = coordinates[current * 2] ?? 0;
            const cy = coordinates[current * 2 + 1] ?? 0;
            const px = coordinates[previous * 2] ?? 0;
            const py = coordinates[previous * 2 + 1] ?? 0;
            if (cy > y !== py > y && x < ((px - cx) * (y - cy)) / (py - cy) + cx)
                inside = !inside;
        }
    }
    return inside;
}
/**
 * Read areas into an index. An input with no geometry, or one that is not a
 * Polygon or MultiPolygon with a readable ring, is not drawn and not hit; its
 * id is in `skipped` so the app can say its area could not be drawn instead of
 * dropping it.
 */
export function createVectorTileAreaIndex(inputs) {
    const skipped = [];
    const read = [];
    for (const [order, input] of inputs.entries()) {
        const drawables = input.geometry
            ? geoJsonFeatureToPolygonDrawables({ geometry: input.geometry, id: input.id, type: 'Feature' }, order)
            : [];
        if (drawables.length === 0) {
            skipped.push(input.id);
            continue;
        }
        const shapes = drawables.map((drawable) => buildShape(drawable.rings));
        let west = Infinity;
        let north = Infinity;
        let east = -Infinity;
        let south = -Infinity;
        for (const shape of shapes) {
            west = Math.min(west, shape.box[0]);
            north = Math.min(north, shape.box[1]);
            east = Math.max(east, shape.box[2]);
            south = Math.max(south, shape.box[3]);
        }
        read.push({
            area: {
                bounds: [
                    // Degrees, read back from the same world units the shapes use.
                    west * 360 - 180,
                    worldYToLatitude(south),
                    east * 360 - 180,
                    worldYToLatitude(north),
                ],
                data: input.data,
                id: input.id,
                priority: Number.isFinite(input.priority) ? input.priority : 0,
                shapes,
            },
            order,
        });
    }
    read.sort((left, right) => right.area.priority - left.area.priority || left.order - right.order);
    const areas = read.map((entry) => entry.area);
    const byId = new Map();
    for (const area of areas)
        if (!byId.has(area.id))
            byId.set(area.id, area);
    function matches(area, x, y, accept) {
        if (accept && !accept(area))
            return false;
        return area.shapes.some((shape) => shapeContains(shape, x, y));
    }
    return {
        areas,
        boundsOf: (id) => byId.get(id)?.bounds ?? null,
        get: (id) => byId.get(id),
        hitTest(coordinate, accept) {
            const x = worldX(coordinate.longitude);
            const y = worldY(coordinate.latitude);
            return areas.find((area) => matches(area, x, y, accept)) ?? null;
        },
        hitTestAll(coordinate, accept) {
            const x = worldX(coordinate.longitude);
            const y = worldY(coordinate.latitude);
            return areas.filter((area) => matches(area, x, y, accept));
        },
        skipped,
    };
}
function styleOutlineWidth(style) {
    return style.strokeColor ? (style.lineWidth ?? 1) : 0;
}
/**
 * Whether anything the layer draws reaches this tile. A tile that nothing
 * reaches needs no area pass, and a tile with no lines under it needs none of
 * the network's either.
 */
export function vectorTileAreasReach(layer, tile, tileSize) {
    if (!layer)
        return false;
    return layer.index.areas.some((area) => {
        const style = layer.style(area);
        return style !== null && areaReaches(area, tile, tileSize, style);
    });
}
function areaReaches(area, tile, tileSize, style) {
    const span = 1 / 2 ** tile.z;
    const margin = (styleOutlineWidth(style) + STROKE_REACH_PX) / tileSize / 2 ** tile.z;
    const left = tile.x * span - margin;
    const right = (tile.x + 1) * span + margin;
    const top = tile.y * span - margin;
    const bottom = (tile.y + 1) * span + margin;
    return area.shapes.some((shape) => shape.box[2] >= left &&
        shape.box[0] <= right &&
        shape.box[3] >= top &&
        shape.box[1] <= bottom);
}
/** Why an area pass could not draw: the canvas cannot fill. */
function fillContext(canvas) {
    const context = canvas.getContext('2d');
    if (!context || !context.fill || !context.closePath)
        return null;
    return context;
}
/**
 * Paint a layer's areas into a tile image, in priority order with the most
 * important on top. Returns `false` when nothing was drawn, including a canvas
 * that cannot fill.
 *
 * It does not clear the canvas: the network is painted over it afterwards, and
 * a caller that wants a clean canvas clears it first. `tile` is the tile being
 * displayed, so a tile above the archive's last zoom needs no special case.
 */
export function paintVectorTileAreas(canvas, layer, options) {
    const context = fillContext(canvas);
    if (!context)
        return false;
    const { pixelRatio, tile, tileSize } = options;
    const tiles = 2 ** tile.z;
    const scale = tileSize * pixelRatio * tiles;
    const originX = tile.x * tileSize * pixelRatio;
    const originY = tile.y * tileSize * pixelRatio;
    const gap = MIN_VERTEX_GAP_PX;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    let painted = false;
    // The index is in hit order; the top of the stack is painted last.
    for (let index = layer.index.areas.length - 1; index >= 0; index -= 1) {
        const area = layer.index.areas[index];
        if (!area)
            continue;
        const style = layer.style(area);
        if (!style || !areaReaches(area, tile, tileSize, style))
            continue;
        const outline = styleOutlineWidth(style);
        const filled = Boolean(style.fillColor);
        if (!filled && outline <= 0)
            continue;
        context.beginPath();
        let added = false;
        for (const shape of area.shapes) {
            const span = 1 / tiles;
            const margin = (outline + STROKE_REACH_PX) / tileSize / tiles;
            if (shape.box[2] < tile.x * span - margin ||
                shape.box[0] > (tile.x + 1) * span + margin ||
                shape.box[3] < tile.y * span - margin ||
                shape.box[1] > (tile.y + 1) * span + margin) {
                continue;
            }
            const { coordinates, ringStarts } = shape;
            for (let ring = 0; ring + 1 < ringStarts.length; ring += 1) {
                const start = ringStarts[ring] ?? 0;
                const end = ringStarts[ring + 1] ?? start;
                if (end - start < 3)
                    continue;
                let lastX = (coordinates[start * 2] ?? 0) * scale - originX;
                let lastY = (coordinates[start * 2 + 1] ?? 0) * scale - originY;
                context.moveTo(lastX, lastY);
                for (let point = start + 1; point < end; point += 1) {
                    const x = (coordinates[point * 2] ?? 0) * scale - originX;
                    const y = (coordinates[point * 2 + 1] ?? 0) * scale - originY;
                    if (point + 1 < end && Math.abs(x - lastX) + Math.abs(y - lastY) < gap)
                        continue;
                    context.lineTo(x, y);
                    lastX = x;
                    lastY = y;
                }
                context.closePath();
                added = true;
            }
        }
        if (!added)
            continue;
        if (filled) {
            context.globalAlpha = style.fillOpacity ?? 1;
            context.fillStyle = style.fillColor;
            context.fill('evenodd');
        }
        if (outline > 0) {
            context.globalAlpha = style.strokeOpacity ?? 1;
            context.strokeStyle = style.strokeColor;
            context.lineWidth = outline * pixelRatio;
            context.stroke();
        }
        painted = true;
    }
    context.globalAlpha = 1;
    return painted;
}
//# sourceMappingURL=vector-tile-areas.js.map