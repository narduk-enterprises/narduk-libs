/** Vertices closer than this, in device pixels, to the last one drawn are skipped. */
const MIN_VERTEX_GAP_PX = 0.4;
/** Room past a tile's edge in which a shape's edge line may still reach it, in CSS pixels. */
const EDGE_REACH_PX = 4;
const WORLD_COPIES = [-1, 0, 1];
function maskContext(canvas) {
    const context = canvas.getContext('2d');
    if (!context || !context.fill || !context.closePath)
        return null;
    return context;
}
function shapeReaches(shape, copy, tile, margin) {
    const span = 1 / 2 ** tile.z;
    return (shape.box[2] + copy >= tile.x * span - margin &&
        shape.box[0] + copy <= (tile.x + 1) * span + margin &&
        shape.box[3] >= tile.y * span - margin &&
        shape.box[1] <= (tile.y + 1) * span + margin);
}
export function createAreaMaskTileSource(options) {
    const { createCanvas, tileSize = 256 } = options;
    let layer = options.layer ?? null;
    /** One flat image per size and layer, for every tile the cut-out does not reach. */
    let solid = null;
    function solidTile(size, current) {
        const key = `${size}|${current.fillColor}|${current.fillOpacity ?? 1}`;
        if (solid?.key === key)
            return solid.canvas;
        const canvas = createCanvas(size, size);
        const context = maskContext(canvas);
        if (!context)
            return null;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(size, 0);
        context.lineTo(size, size);
        context.lineTo(0, size);
        context.closePath();
        context.globalAlpha = current.fillOpacity ?? 1;
        context.fillStyle = current.fillColor;
        context.fill();
        context.globalAlpha = 1;
        solid = { canvas, key };
        return canvas;
    }
    return {
        async imageForTile(x, y, z, scale) {
            const current = layer;
            if (!current)
                return null;
            const pixelRatio = scale > 0 ? scale : 1;
            const size = Math.round(tileSize * pixelRatio);
            const tile = { x, y, z };
            const tiles = 2 ** z;
            const margin = EDGE_REACH_PX / tileSize / tiles;
            const wanted = current.ids ? new Set(current.ids) : null;
            const areas = current.index.areas.filter((area) => !wanted || wanted.has(area.id));
            const reached = [];
            for (const area of areas) {
                for (const shape of area.shapes) {
                    for (const copy of WORLD_COPIES) {
                        if (shapeReaches(shape, copy, tile, margin))
                            reached.push({ copy, shape });
                    }
                }
            }
            if (reached.length === 0)
                return solidTile(size, current);
            const canvas = createCanvas(size, size);
            const context = maskContext(canvas);
            if (!context)
                return null;
            const scalePx = tileSize * pixelRatio * tiles;
            const originX = x * tileSize * pixelRatio;
            const originY = y * tileSize * pixelRatio;
            context.beginPath();
            context.moveTo(0, 0);
            context.lineTo(size, 0);
            context.lineTo(size, size);
            context.lineTo(0, size);
            context.closePath();
            for (const { copy, shape } of reached) {
                const { coordinates, ringStarts } = shape;
                for (let ring = 0; ring + 1 < ringStarts.length; ring += 1) {
                    const start = ringStarts[ring] ?? 0;
                    const end = ringStarts[ring + 1] ?? start;
                    if (end - start < 3)
                        continue;
                    let lastX = ((coordinates[start * 2] ?? 0) + copy) * scalePx - originX;
                    let lastY = (coordinates[start * 2 + 1] ?? 0) * scalePx - originY;
                    context.moveTo(lastX, lastY);
                    for (let point = start + 1; point < end; point += 1) {
                        const px = ((coordinates[point * 2] ?? 0) + copy) * scalePx - originX;
                        const py = (coordinates[point * 2 + 1] ?? 0) * scalePx - originY;
                        if (point + 1 < end &&
                            Math.abs(px - lastX) + Math.abs(py - lastY) < MIN_VERTEX_GAP_PX) {
                            continue;
                        }
                        context.lineTo(px, py);
                        lastX = px;
                        lastY = py;
                    }
                    context.closePath();
                }
            }
            context.globalAlpha = current.fillOpacity ?? 1;
            context.fillStyle = current.fillColor;
            context.fill('evenodd');
            if (current.edge && current.edge.width > 0) {
                // Stroke the cut-out alone: a second path without the tile's rectangle.
                context.beginPath();
                for (const { copy, shape } of reached) {
                    const { coordinates, ringStarts } = shape;
                    for (let ring = 0; ring + 1 < ringStarts.length; ring += 1) {
                        const start = ringStarts[ring] ?? 0;
                        const end = ringStarts[ring + 1] ?? start;
                        if (end - start < 3)
                            continue;
                        context.moveTo(((coordinates[start * 2] ?? 0) + copy) * scalePx - originX, (coordinates[start * 2 + 1] ?? 0) * scalePx - originY);
                        for (let point = start + 1; point < end; point += 1) {
                            context.lineTo(((coordinates[point * 2] ?? 0) + copy) * scalePx - originX, (coordinates[point * 2 + 1] ?? 0) * scalePx - originY);
                        }
                        context.closePath();
                    }
                }
                context.lineCap = 'round';
                context.lineJoin = 'round';
                context.globalAlpha = current.edge.opacity ?? 1;
                context.strokeStyle = current.edge.color;
                context.lineWidth = current.edge.width * pixelRatio;
                context.stroke();
            }
            context.globalAlpha = 1;
            return canvas;
        },
        get layer() {
            return layer;
        },
        setLayer(next) {
            layer = next;
            solid = null;
        },
    };
}
//# sourceMappingURL=area-mask-tiles.js.map