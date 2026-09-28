/**
 * Path and colour geometry for the instruments a mark hangs off its dot.
 *
 * Extracted from Buoys' instrument renderer. Bearings are compass degrees
 * (0 = north, clockwise);
 * paths are in mark-local px with the station at the origin and y down.
 * Vocabulary-free: nothing here knows what a
 * knot, a swell or a degree Fahrenheit is.
 */
/** One decimal is as fine as a pin ever needs, and keeps repaint signatures short. */
function n2(value) {
    return Math.round(value * 10) / 10;
}
function pt(x, y) {
    return `${n2(x)} ${n2(y)}`;
}
/** Unit vectors along a bearing (`u`) and 90 degrees clockwise of it (`n`). */
function vec(deg) {
    const a = (deg * Math.PI) / 180;
    return { nx: Math.cos(a), ny: Math.sin(a), ux: Math.sin(a), uy: -Math.cos(a) };
}
/** A point `r` px out along a bearing. */
function polar(deg, r) {
    const a = (deg * Math.PI) / 180;
    return `${n2(r * Math.sin(a))} ${n2(-r * Math.cos(a))}`;
}
/**
 * A comet leaving the origin along `deg`, `w0` half-wide where it starts and
 * rounded off at `w1` where it ends: the windsock.
 */
export function sockPath(deg, start, len, w0, w1) {
    if (len < 1)
        return '';
    const v = vec(deg);
    const sx = v.ux * start;
    const sy = v.uy * start;
    const tx = v.ux * (start + len);
    const ty = v.uy * (start + len);
    return [
        `M${pt(sx + v.nx * w0, sy + v.ny * w0)}`,
        `L${pt(tx + v.nx * w1, ty + v.ny * w1)}`,
        `A${w1} ${w1} 0 0 0 ${pt(tx - v.nx * w1, ty - v.ny * w1)}`,
        `L${pt(sx - v.nx * w0, sy - v.ny * w0)}`,
        'Z',
    ].join('');
}
/** Arcs centred on the origin, each spanning `half` degrees either side of `deg`. */
export function crestsPath(deg, radii, half) {
    return radii
        .map((r) => `M${polar(deg - half, r)}A${r} ${r} 0 0 1 ${polar(deg + half, r)}`)
        .join('');
}
/** Full rings at the given radii, for a reading whose direction is not reported. */
export function ringsPath(radii) {
    return radii.map((r) => `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}`).join('');
}
/** An arc of radius `r` from 12 o'clock, clockwise, `fraction` of the way round. */
export function arcPath(r, fraction) {
    if (fraction <= 0.005)
        return '';
    if (fraction >= 0.995)
        return ringsPath([r]);
    return `M0 ${-r}A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${polar(360 * fraction, r)}`;
}
/**
 * Crest radii from the outermost inward, `spacing` apart, stopping before
 * `min`. The outermost crest is the reading; the spacing is the period.
 */
export function crestRadii(reach, spacing, min) {
    if (![reach, spacing, min].every(Number.isFinite) || spacing <= 0) {
        throw new RangeError('Crest radii require finite bounds and positive spacing.');
    }
    const radii = [];
    for (let r = reach; r >= min; r -= spacing)
        radii.push(n2(r));
    return radii;
}
/**
 * `hex` laid over `over` at `alpha`, resolved to an opaque `#rrggbb`. It stays
 * hex so the result can be both painted and handed back to `onColor`.
 */
export function mix(hex, over, alpha) {
    const n = Number.parseInt(hex.slice(1), 16);
    const k = Number.parseInt(over.slice(1), 16);
    const channel = (shift) => Math.round(((n >> shift) & 255) * alpha + ((k >> shift) & 255) * (1 - alpha));
    const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
    return `#${value.toString(16).padStart(6, '0')}`;
}
/** Whichever of `dark`/`light` reads on `hex`, by Rec. 709 luminance. */
export function onColor(hex, dark, light) {
    const n = Number.parseInt(hex.slice(1), 16);
    const luma = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return luma > 150 ? dark : light;
}
//# sourceMappingURL=instruments.js.map