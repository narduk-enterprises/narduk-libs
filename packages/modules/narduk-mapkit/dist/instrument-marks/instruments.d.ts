/**
 * Path and colour geometry for the instruments a mark hangs off its dot.
 *
 * Extracted from Buoys' instrument renderer. Bearings are compass degrees
 * (0 = north, clockwise);
 * paths are in mark-local px with the station at the origin and y down.
 * Vocabulary-free: nothing here knows what a
 * knot, a swell or a degree Fahrenheit is.
 */
/**
 * A comet leaving the origin along `deg`, `w0` half-wide where it starts and
 * rounded off at `w1` where it ends: the windsock.
 */
export declare function sockPath(deg: number, start: number, len: number, w0: number, w1: number): string;
/** Arcs centred on the origin, each spanning `half` degrees either side of `deg`. */
export declare function crestsPath(deg: number, radii: readonly number[], half: number): string;
/** Full rings at the given radii, for a reading whose direction is not reported. */
export declare function ringsPath(radii: readonly number[]): string;
/** An arc of radius `r` from 12 o'clock, clockwise, `fraction` of the way round. */
export declare function arcPath(r: number, fraction: number): string;
/**
 * Crest radii from the outermost inward, `spacing` apart, stopping before
 * `min`. The outermost crest is the reading; the spacing is the period.
 */
export declare function crestRadii(reach: number, spacing: number, min: number): number[];
/**
 * `hex` laid over `over` at `alpha`, resolved to an opaque `#rrggbb`. It stays
 * hex so the result can be both painted and handed back to `onColor`.
 */
export declare function mix(hex: string, over: string, alpha: number): string;
/** Whichever of `dark`/`light` reads on `hex`, by Rec. 709 luminance. */
export declare function onColor(hex: string, dark: string, light: string): string;
/**
 * One drawn specimen in a legend key: the same layers a mark paints, at a
 * fixed offset along a strip. `x` is its centre in the strip's own
 * coordinates; every path is in local px around that centre, exactly as a
 * mark's are around its station.
 */
export interface InstrumentSpecimen {
    body: string;
    bodyFill: string;
    bodyStroke: string;
    bodyWidth: number;
    dotFill: string;
    dotRadius: number;
    /** Hairline under an arc, or `''`. */
    track: string;
    x: number;
}
/** A legend key: its specimens and the strip width they need. */
export interface InstrumentKey {
    marks: InstrumentSpecimen[];
    width: number;
}
//# sourceMappingURL=instruments.d.ts.map