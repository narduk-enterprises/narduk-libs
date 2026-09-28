/**
 * DOM builders for map marks. MapKit places each element as an annotation, so the
 * root is a zero-size anchor on the coordinate and the visible parts hang off it.
 * Styles are exported as MAPKIT_INSTRUMENT_MARKS_CSS. Callers supply every word of copy and
 * every path: the drawing is a stack of SVG layers whose geometry, colours and
 * dash patterns are all inputs, never NOAA/Buoys vocabulary, so products can share the renderer without sharing their domain rules. A crowd is drawn one
 * way only -- a second dot behind the mark (`PinStack`); there is no count ring
 * and no `+n` badge.
 */
export interface MarkTarget {
    ariaLabel: string;
    data?: Readonly<Record<string, string>>;
    onSelect: () => void;
}
/** The name pill's height. */
export declare const NAME_PILL_HEIGHT = 22;
/** How far the stack dot is nudged right and up from the mark's own dot. */
export declare const STACK_OFFSET = 4;
/**
 * One mark's drawing, as the layers the pin markup paints bottom to top: a
 * white halo under the instrument, a faint `ghost` extension of it, a hairline
 * `track` under an arc, the `body` instrument itself, a `calm` ring for a
 * reading below the instrument's threshold, then the dot (or badge) and its
 * numeral. Paths are in mark-local px with the anchor at the origin and y
 * down; `''` means the layer is not drawn.
 */
export interface PinPaint {
    /**
     * Compass bearing the instrument reaches along, or `null` when it is
     * radially symmetric. Only used to pick the side a value tab opens on.
     */
    bearing: number | null;
    body: string;
    /** SVG `stroke-dasharray`, or `'none'`. */
    bodyDash: string;
    bodyFill: string;
    bodyStroke: string;
    bodyWidth: number;
    calm: string;
    calmStroke: string;
    dotDash: string;
    dotFill: string;
    dotRadius: number;
    dotStroke: string;
    dotWidth: number;
    /** How far the whole drawing reaches from the anchor; sizes the canvas. */
    extent: number;
    /** The reading's own colour, for the ghost and the stack dot. */
    fill: string;
    fontSize: number;
    /**
     * The dot's own reach. The tab, the name and the selection ring hang off
     * this rather than off `extent`, so they stay beside the station instead of
     * chasing the far tip of a long instrument.
     */
    footprint: number;
    ghost: string;
    halo: string;
    haloWidth: number;
    /** Numeral colour. */
    ink: string;
    /** Selection-ring radius; `0` derives one from the dot. */
    selRadius: number;
    /** Numeral inside the dot or badge, or `''`. */
    text: string;
    track: string;
}
/** A second dot behind a mark that hides neighbours: nudged up-right. */
export interface PinStack {
    color: string;
    /** Offset in px, applied right and up. */
    offset: number;
}
/** The selection ring's radius: the paint's own, or one clear of the dot. */
export declare function selectionRadius(paint: PinPaint): number;
/**
 * A single pin: a `.mk-pin` hit target sized to at least `hitSize` (a
 * transparent halo keeps touch targets >= 44 px without growing the drawing),
 * the drawing itself, and optionally a value tab beside it and a station name
 * below it. The aria-label doubles as the hover tooltip, so the hidden count
 * reads the same both ways.
 */
export declare function createPinMark(target: MarkTarget & {
    hitSize: number;
    /** Text hung below the drawing, or `null`/absent for none. */
    name?: string | null;
    paint: PinPaint;
    selected: boolean;
    stack: PinStack | null;
    /** Reading hung beside the drawing, or `null`/absent for none. */
    tab?: string | null;
}): HTMLElement;
/**
 * A selected pin plus its name callout, sharing one zero-size anchor: the pin
 * keeps its ink selection ring and the name is a solid ink pill joined to that
 * ring by a leader line (#239).
 */
export declare function createSelectedMark(target: MarkTarget & {
    flip: boolean;
    hitSize: number;
    name: string;
    paint: PinPaint;
    /** Reading hung beside the drawing when the pin itself has no numeral. */
    tab?: string | null;
}): HTMLElement;
/** How far out from the anchor a selected pin's name pill starts. */
export declare function selectedReach(paint: PinPaint): number;
export declare function createBackgroundMark(kind: 'pip' | 'void', size: number): HTMLElement;
/** Rough rendered width of the name pill alone. */
export declare function namePillWidth(name: string): number;
/** Rough rendered width of a selected pin plus its name pill, to pick which side it opens. */
export declare function selectedMarkWidth(paint: PinPaint, name: string): number;
//# sourceMappingURL=marks.d.ts.map