import type { MapKitFrameScheduler } from './timers.js';
/** Receives the regions marked dirty since the previous flush. Never empty. */
export type MapKitRenderFlushListener = (regions: ReadonlySet<string>) => void;
export interface MapKitRenderSchedulerOptions {
    cancelAnimationFrame?: MapKitFrameScheduler['cancelAnimationFrame'];
    /** Run once per frame with the accumulated dirty regions. */
    onFlush: MapKitRenderFlushListener;
    requestAnimationFrame?: MapKitFrameScheduler['requestAnimationFrame'];
}
export interface MapKitRenderScheduler {
    /** Drop the pending frame and the dirty regions without flushing. */
    cancel: () => void;
    /** Cancel and make the scheduler inert. Idempotent; `mark()` then no-ops. */
    destroy: () => void;
    readonly destroyed: boolean;
    /**
     * Flush synchronously instead of waiting for the frame, cancelling it. A
     * no-op when nothing is dirty, so it never fires an empty render.
     */
    flushNow: () => void;
    /** Mark `region` dirty and schedule a flush if one is not already pending. */
    mark: (region: string) => void;
    /** Snapshot of the regions waiting for the next flush. */
    readonly pendingRegions: ReadonlySet<string>;
    /** Whether a frame is currently pending. */
    readonly scheduled: boolean;
}
/**
 * Coalesce many `mark(region)` calls into one flush per animation frame.
 *
 * `region` is a caller-defined string -- this module never interprets it -- so
 * a consumer can flush selectively (`'markers'`, `'legend'`, `'readout'`)
 * instead of redrawing the whole surface for whichever input changed.
 *
 * Marking from inside `onFlush` is safe: those regions land in the next frame
 * rather than recursing into the current flush.
 */
export declare function createMapKitRenderScheduler(options: MapKitRenderSchedulerOptions): MapKitRenderScheduler;
/**
 * The structural subset of an element the slot renderer writes to. A real
 * `HTMLElement` satisfies it, and so does `{ innerHTML: '' }` in a Node test.
 */
export interface MapKitHtmlSlotElement {
    innerHTML: string;
}
export interface MapKitHtmlSlotEntry<TElement extends MapKitHtmlSlotElement> {
    element: TElement;
    html: string;
}
export interface MapKitHtmlSlotRenderer<TElement extends MapKitHtmlSlotElement> {
    /** Drop the remembered HTML for an element, e.g. once it is detached. */
    forget: (element: TElement) => void;
    /** Write `html` unless the element already holds exactly it. Returns whether it wrote. */
    write: (element: TElement, html: string) => boolean;
    /** Write several slots in one pass. Returns how many actually changed. */
    writeAll: (entries: Iterable<MapKitHtmlSlotEntry<TElement>>) => number;
}
/**
 * Remember the last HTML written per element and skip byte-identical writes.
 *
 * Assigning `innerHTML` destroys and rebuilds the subtree even when the string
 * is unchanged, which is what makes a re-rendered marker callout or readout
 * blink and drop its selection. The remembered strings live in a `WeakMap`, so
 * a detached element is collectable without an explicit `forget()`.
 *
 * The cache records what this renderer wrote, not what the DOM currently
 * holds. Call `forget()` for any element something else has written to.
 */
export declare function createMapKitHtmlSlotRenderer<TElement extends MapKitHtmlSlotElement = MapKitHtmlSlotElement>(): MapKitHtmlSlotRenderer<TElement>;
/**
 * The structural subset of a focused element the focus preserver reads and
 * restores. Declared structurally so it can be faked without a DOM.
 */
export interface MapKitFocusableElement {
    focus?: (options?: {
        preventScroll?: boolean;
    }) => void;
    selectionEnd?: number | null;
    selectionStart?: number | null;
    setSelectionRange?: (start: number, end: number) => void;
}
/** What was focused before a batch of writes, addressed by stable key. */
export interface MapKitFocusSnapshot {
    readonly key: string;
    readonly selectionEnd: number | null;
    readonly selectionStart: number | null;
}
export interface MapKitFocusPreserverOptions {
    /** The element holding focus right now, usually `() => document.activeElement`. */
    activeElement: () => unknown;
    /**
     * Stable identity for an element that survives the rewrite -- an `id`, or a
     * `data-` attribute the render emits. Return `null` for anything not worth
     * restoring, which skips the whole capture.
     */
    identify: (element: unknown) => string | null;
    /**
     * Find the element carrying `key` after the rewrite, usually a
     * `querySelector`. Return `null` when the slot no longer renders it.
     */
    resolve: (key: string) => MapKitFocusableElement | null;
}
export interface MapKitFocusPreserver {
    /** Snapshot the focused element's key and selection, or `null` if none qualifies. */
    capture: () => MapKitFocusSnapshot | null;
    /** Capture, run `write`, then restore -- including when `write` throws. */
    preserve: <TResult>(write: () => TResult) => TResult;
    /** Re-focus the snapshot's key and reapply its selection. Returns whether it focused. */
    restore: (snapshot: MapKitFocusSnapshot | null) => boolean;
}
/**
 * Keep the caret across a slot rewrite.
 *
 * Replacing a slot's `innerHTML` destroys the focused node, so the browser
 * moves focus to `<body>` and the user loses their caret mid-keystroke. The
 * element identity cannot survive the rewrite, so focus is restored by the
 * caller's own stable key instead of by object reference.
 *
 * Selection access is guarded: reading `selectionStart` throws on input types
 * that do not support it (`number`, `email`, `date`), and so does
 * `setSelectionRange`. Those cases restore focus without a selection rather
 * than failing the render.
 */
export declare function createMapKitFocusPreserver(options: MapKitFocusPreserverOptions): MapKitFocusPreserver;
//# sourceMappingURL=render.d.ts.map