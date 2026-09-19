/**
 * Overflow-edge detection for a one-axis scroller (phone map lens chips and
 * station-history product tabs). Framework-free so the viewport-fixed overflow
 * cues can be unit-tested without a DOM.
 */
export interface OverflowEdges {
    end: boolean;
    start: boolean;
}
/**
 * Whether a scroller has content past its start and/or end.
 *
 * `scrollStart` is `scrollLeft` (or `scrollTop` on a vertical scroller),
 * `visible` is the client size on that axis, and `content` is the scroll size.
 */
export declare function overflowEdges(scrollStart: number, visible: number, content: number, slop?: number): OverflowEdges;
//# sourceMappingURL=overflow.d.ts.map