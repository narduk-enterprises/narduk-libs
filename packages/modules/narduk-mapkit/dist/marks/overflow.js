/**
 * Overflow-edge detection for a one-axis scroller (phone map lens chips and
 * station-history product tabs). Framework-free so the viewport-fixed overflow
 * cues can be unit-tested without a DOM.
 */
/** One CSS pixel of slop so subpixel layout does not flicker the fade. */
const OVERFLOW_SLOP_PX = 1;
/**
 * Whether a scroller has content past its start and/or end.
 *
 * `scrollStart` is `scrollLeft` (or `scrollTop` on a vertical scroller),
 * `visible` is the client size on that axis, and `content` is the scroll size.
 */
export function overflowEdges(scrollStart, visible, content, slop = OVERFLOW_SLOP_PX) {
    if (content <= visible + slop)
        return { end: false, start: false };
    return {
        end: scrollStart + visible < content - slop,
        start: scrollStart > slop,
    };
}
//# sourceMappingURL=overflow.js.map