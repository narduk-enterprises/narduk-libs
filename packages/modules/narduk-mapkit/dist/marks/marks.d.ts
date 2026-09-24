/**
 * DOM builders for map marks. MapKit places each element as an annotation, so the
 * root is a zero-size anchor on the coordinate and the visible parts hang off it.
 * Styles live in assets/css/mapkit.css. Callers supply every word of copy and
 * every colour: size, colour and stack rims are inputs, never NOAA/Buoys
 * vocabulary, so this file can move into `@narduk-enterprises/narduk-mapkit`
 * unchanged. A crowd is drawn one way only -- a second rim behind the pin
 * (`PinStack`); there is no count ring and no `+n` badge.
 */
export interface MarkTarget {
    ariaLabel: string;
    data?: Readonly<Record<string, string>>;
    onSelect: () => void;
}
/** The selection ring's reach past the disc: a 3 px white halo gap plus a 2 px ring. */
export declare const SELECTED_RING = 5;
/** The leader line between the selection ring and the name pill. */
export declare const NAME_LEADER = 10;
/** The name pill's height. */
export declare const NAME_PILL_HEIGHT = 22;
/** A dynamic-radius pin: size is the reading, colour is the class, ring is the age. */
export interface PinPaint {
    /** CSS background, e.g. a ramp hex or `#ffffff` for a stale/void pin. */
    fill: string;
    fontSize: number;
    /** Direction pictogram drawn on the disc, or `null` for none. */
    glyph: PinGlyph | null;
    /** Pin text colour. */
    ink: string;
    radius: number;
    /** CSS `border` shorthand for the age ring, or `'0'` for none. */
    ring: string;
    /** Value text inside the disc, or `''` for a colour-and-size-only pin. */
    text: string;
}
/**
 * The direction pictogram on a pin, rotated `bearing` degrees clockwise
 * from north:
 * - `notch`: a small arrowhead on the rim in the disc's own colour, pointing
 *   along the bearing; it fits the declutter footprint at any size.
 * - `path`: any drawing in pin-local coordinates (origin at the disc centre,
 *   up is the bearing), stroked in ink over a white halo, reaching at most
 *   `extent` px from the centre. The caller supplies the path data, so a
 *   wind barb needs no weather vocabulary here.
 */
export type PinGlyph = {
    bearing: number;
    kind: 'notch';
} | {
    bearing: number;
    extent: number;
    fill: string;
    kind: 'path';
    stroke: string;
};
/** A second rim behind a pin that hides neighbours: same size, nudged up-right. */
export interface PinStack {
    color: string;
    /** Offset in px, applied right and up. */
    offset: number;
}
/**
 * A single dynamic pin: a `.mk-pin` hit target sized to at least `hitSize`
 * (a transparent halo keeps touch targets >= 44 px without growing the
 * visible disc), an inner disc painted per `paint`, and an optional stack
 * rim behind it for hidden neighbours. The aria-label doubles as the hover
 * tooltip, so the hidden count reads the same both ways.
 */
export declare function createPinMark(target: MarkTarget & {
    hitSize: number;
    /** Text hung below the disc, or `null`/absent for none. */
    name?: string | null;
    paint: PinPaint;
    selected: boolean;
    stack: PinStack | null;
}): HTMLElement;
/**
 * A selected pin plus its name callout, sharing one zero-size anchor: the pin
 * keeps its numeral inside a white halo gap and ring, and the name is a solid
 * ink pill joined to the ring by a leader line (#239).
 */
export declare function createSelectedMark(target: MarkTarget & {
    flip: boolean;
    hitSize: number;
    name: string;
    paint: PinPaint;
}): HTMLElement;
export declare function createBackgroundMark(kind: 'pip' | 'void', size: number): HTMLElement;
/** Rough rendered width of the name pill alone. */
export declare function namePillWidth(name: string): number;
/** Rough rendered width of a selected pin plus its name pill, to pick which side it opens. */
export declare function selectedMarkWidth(paint: PinPaint, name: string): number;
//# sourceMappingURL=marks.d.ts.map