/**
 * Spatial keyboard navigation between map points (roving tabindex).
 *
 * A map with 200 focusable pins is 200 Tab stops. The accessible pattern is a
 * *roving tabindex*: the pin group is one Tab stop and the arrow keys move
 * between pins. On a map "next" has no list order, so the arrows move to the
 * nearest pin in that compass direction.
 *
 * Pure and unit-free: it works on latitude and longitude, not pixels, so it
 * needs no projection (the fake MapKit does not model one) and gives the same
 * answer at every zoom. Longitude is scaled by `cos(latitude)` so east-west and
 * north-south distances are comparable.
 */
/** Weight of the cross-axis offset: 2 favours a pin straight ahead over a nearer one off to the side. */
const CROSS_AXIS_WEIGHT = 2;
function readingOrder(a, b) {
    return b.lat - a.lat || a.lng - b.lng || a.key.localeCompare(b.key);
}
/**
 * The key to move focus to, or `null` when there is nowhere to go (an arrow at
 * the edge of the group, or an empty group).
 *
 * `from` that is `null` or no longer present is treated as "start of the
 * group", so the first arrow press always lands somewhere.
 */
export function nextMapKitRovingKey(points, from, direction) {
    if (points.length === 0)
        return null;
    const ordered = [...points].sort(readingOrder);
    if (direction === 'first')
        return ordered[0]?.key ?? null;
    if (direction === 'last')
        return ordered.at(-1)?.key ?? null;
    const origin = from === null ? undefined : points.find((point) => point.key === from);
    if (!origin)
        return ordered[0]?.key ?? null;
    const scale = Math.max(Math.cos((origin.lat * Math.PI) / 180), 1e-6);
    let best = null;
    for (const point of points) {
        if (point.key === origin.key)
            continue;
        const east = (((((point.lng - origin.lng + 180) % 360) + 360) % 360) - 180) * scale;
        const north = point.lat - origin.lat;
        const [along, across] = direction === 'north'
            ? [north, east]
            : direction === 'south'
                ? [-north, east]
                : direction === 'east'
                    ? [east, north]
                    : [-east, north];
        // Strictly ahead: a pin level with, or behind, the origin is not "that way".
        if (along <= 0)
            continue;
        const score = along + CROSS_AXIS_WEIGHT * Math.abs(across);
        if (!best || score < best.score || (score === best.score && point.key < best.key)) {
            best = { key: point.key, score };
        }
    }
    return best?.key ?? null;
}
//# sourceMappingURL=roving.js.map