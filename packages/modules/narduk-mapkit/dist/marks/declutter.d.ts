/**
 * Framework-free point-map declutter engine: greedily places same-layer
 * circles largest-first, folding anything a placed circle overlaps into that
 * circle's `absorbed` id list instead of drawing it, lets a primary layer
 * absorb an overlapping secondary layer the same way, and thins a background
 * layer of context marks clear of what got placed. No DOM, no Vue/Nuxt, no
 * domain vocabulary -- the caller supplies already-projected pixel positions
 * (and each item's own radius) and reads back pixel layout.
 *
 * Ported from the site-redesign-v2 prototype (`Main.dc.html`/`Mobile.dc.html`
 * `layout()`): sort by rank then radius, walk the sorted list once, and fold
 * an item into the first already-placed circle it overlaps. The prototype's
 * placement loop is O(n^2) (it rescans every placed circle for every
 * candidate) and its tie-breaks fall out of incidental array order; this
 * port is deterministic by construction and finds the first overlap through
 * a uniform spatial grid, so it stays fast at map-sized input counts. Two
 * rules the prototype left implicit are made explicit here:
 *
 *   1. Every priority comparison breaks an exact tie by ascending id
 *      (`comparePriority`), so the result never depends on input order.
 *   2. Every id list the engine returns (`absorbed`) is sorted by that same
 *      rule, and so is the final `marks` array.
 *
 * There is no cluster shape in this engine any more: v2 has no chip boxes
 * and no centroid-merged cluster bubble. A caller that wants the "cell hides
 * a lot of stations" fallback the boards describe reads it straight off
 * `DeclutterDot.absorbed.length` -- that is a rendering choice, not a layout
 * one, so it belongs in the caller's own domain code, not here.
 */
export interface DeclutterItem {
    id: string;
    /** Absorbs an overlapping item from the other layer when they touch. */
    layer: 'primary' | 'secondary';
    priority: number;
    /** Pixel radius the caller will render this item at, and the merge test uses. */
    radius: number;
    x: number;
    y: number;
}
export interface DeclutterBackgroundItem {
    id: string;
    kind: 'pip' | 'void';
    x: number;
    y: number;
}
export interface DeclutterInput {
    /** Context marks (no reading on this lens); thinned clear of what got placed. */
    background: readonly DeclutterBackgroundItem[];
    /** Minimum clearance, in pixels, kept between two placed circles' edges. */
    gap: number;
    items: readonly DeclutterItem[];
}
export interface DeclutterDot {
    absorbed: string[];
    id: string;
    kind: 'dot';
    radius: number;
    x: number;
    y: number;
}
export interface DeclutterResult {
    background: DeclutterBackgroundItem[];
    marks: DeclutterDot[];
}
/**
 * Optional diagnostic counters for inner-loop work. Pass an object of zeroes
 * to accumulate; omit it (the production path) so every increment is skipped.
 * Callers own the object — this module never allocates one.
 */
export interface DeclutterStats {
    /** Spatial-grid cell lookups (9 per neighbourhood query). */
    cellVisits: number;
    /** Occupied-rect overlap tests while thinning background. */
    occupiedChecks: number;
    /** Distance comparisons in mergeLayer, resolveLayers, and background proximity. */
    pairChecks: number;
}
export declare function declutter(input: DeclutterInput, stats?: DeclutterStats): DeclutterResult;
export interface PeakCandidate {
    id: string;
    /** Higher wins; an exact tie breaks by ascending id. */
    score: number;
    x: number;
    y: number;
}
/**
 * Picks the ids that earn a numeral: walking candidates strongest first, a
 * candidate is a peak when no already-picked peak sits within `spacing`
 * pixels of it, and the walk stops at `cap` peaks. A spatial grid with
 * `spacing`-sized cells keeps each test to a 3x3 neighbourhood, so the pass
 * is one sort plus O(n).
 */
export declare function pickPeaks(candidates: readonly PeakCandidate[], spacing: number, cap: number): Set<string>;
/**
 * The value most of `values` share. A tie goes to the value `severity` ranks
 * higher (the worse state), so a split cell never reads better than it is.
 */
export declare function majority<T>(values: readonly T[], severity: (value: T) => number): T | undefined;
//# sourceMappingURL=declutter.d.ts.map