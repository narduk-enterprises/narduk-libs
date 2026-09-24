/** Web Mercator's usable latitude range; beyond it the projection diverges. */
const MAX_LATITUDE = 85.051_128_779_806_59;
/**
 * Project a coordinate into the tile pyramid at `zoom`.
 *
 * `x` and `y` come back in the tile's own extent units rather than as a
 * fraction, so a caller compares them against geometry without rescaling.
 * Longitude wraps, so a probe at 181 degrees lands where 179 west does.
 */
export function projectToTilePoint(coordinate, zoom, extent) {
    const scale = 2 ** zoom;
    const latitude = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, coordinate.latitude));
    const radians = (latitude * Math.PI) / 180;
    const worldX = (((coordinate.longitude + 180) % 360) + 360) % 360;
    const fractionX = (worldX / 360) * scale;
    const fractionY = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale;
    const tileX = Math.floor(fractionX);
    // A probe exactly at the pole would land one tile past the bottom row.
    const tileY = Math.min(scale - 1, Math.max(0, Math.floor(fractionY)));
    return {
        tileX: tileX % scale,
        tileY,
        x: (fractionX - tileX) * extent,
        y: (fractionY - tileY) * extent,
    };
}
/** Squared distance from a point to a segment, in the units it was given. */
function segmentDistanceSquared(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
        const zx = px - ax;
        const zy = py - ay;
        return zx * zx + zy * zy;
    }
    // Where the perpendicular meets the segment, clamped to its ends.
    let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const zx = px - cx;
    const zy = py - cy;
    return zx * zx + zy * zy;
}
/**
 * Nearest feature in one decoded tile, or `null` if none is within `within`.
 *
 * The walk is over the flat arrays directly: a tile of flowlines is on the
 * order of 10^5 points, and materialising a point object per candidate during
 * a gesture is what a columnar tile exists to avoid. Comparison stays squared
 * until the end, so the loop has no square root in it.
 *
 * The probe may sit outside `[0, extent]` -- that is how a neighbouring tile is
 * asked whether its geometry reaches back across the shared edge -- so nothing
 * here assumes the point is inside the tile.
 */
export function hitTestTile(tile, x, y, within) {
    const limit = within * within;
    let bestSquared = limit;
    let bestFeature = -1;
    const featureCount = Math.max(0, tile.featureLines.length - 1);
    for (let feature = 0; feature < featureCount; feature += 1) {
        const lineStart = tile.featureLines[feature] ?? 0;
        const lineEnd = tile.featureLines[feature + 1] ?? lineStart;
        for (let line = lineStart; line < lineEnd; line += 1) {
            const pointStart = tile.lineStarts[line] ?? 0;
            const pointEnd = tile.lineStarts[line + 1] ?? pointStart;
            for (let point = pointStart; point + 1 < pointEnd; point += 1) {
                const ax = tile.coordinates[point * 2] ?? 0;
                const ay = tile.coordinates[point * 2 + 1] ?? 0;
                const bx = tile.coordinates[point * 2 + 2] ?? 0;
                const by = tile.coordinates[point * 2 + 3] ?? 0;
                const squared = segmentDistanceSquared(x, y, ax, ay, bx, by);
                if (squared < bestSquared) {
                    bestSquared = squared;
                    bestFeature = feature;
                }
            }
        }
    }
    if (bestFeature < 0)
        return null;
    return { distance: Math.sqrt(bestSquared), feature: bestFeature };
}
/** The tile addresses a probe can reach, given how close it is to an edge. */
export function hitTestNeighbours(point, zoom, extent, within) {
    const scale = 2 ** zoom;
    const columns = [0];
    if (point.x < within)
        columns.push(-1);
    if (point.x > extent - within)
        columns.push(1);
    const rows = [0];
    if (point.y < within)
        rows.push(-1);
    if (point.y > extent - within)
        rows.push(1);
    const out = [];
    for (const column of columns) {
        for (const row of rows) {
            const y = point.tileY + row;
            // The pyramid has no row above the first or below the last; longitude
            // wraps, so a column does.
            if (y < 0 || y >= scale)
                continue;
            out.push({
                offsetX: (((point.tileX + column) % scale) + scale) % scale,
                offsetY: y,
                // Stated in the neighbour's own units: a probe one tile to the west
                // sits at `extent + x` from that tile's origin.
                x: point.x - column * extent,
                y: point.y - row * extent,
            });
        }
    }
    return out;
}
//# sourceMappingURL=hit-test.js.map