/**
 * Render coalescing and write elision for map surfaces.
 *
 * A map view usually has many small state changes -- hover, opacity, date,
 * region, selection -- and one render function that redraws everything. Wired
 * naively, each change runs a full re-render: a consumer map measured on
 * 2026-08-28 replaced 577 DOM nodes for a single mouse-hover tick, and eight
 * hover samples produced 4,061 DOM mutations.
 *
 * Two independent pieces fix that, and they compose:
 *
 * - `createMapKitRenderScheduler()` collapses many `mark()` calls into one
 *   flush per animation frame, so N state changes cost one render.
 * - `createMapKitHtmlSlotRenderer()` drops the DOM write when the HTML for a
 *   slot is byte-identical to what is already there, so a render that produced
 *   the same markup costs no mutations at all.
 *
 * Neither piece touches a DOM global at import time; the element surfaces are
 * declared structurally so they can be exercised in Node with plain objects.
 */
import { defaultMapKitFrameScheduler } from './timers.js';
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
export function createMapKitRenderScheduler(options) {
    const requestFrame = options.requestAnimationFrame ?? defaultMapKitFrameScheduler.requestAnimationFrame;
    const cancelFrame = options.cancelAnimationFrame ?? defaultMapKitFrameScheduler.cancelAnimationFrame;
    let regions = new Set();
    let frameHandle = null;
    let flushing = false;
    let destroyed = false;
    function cancelFrameIfPending() {
        if (frameHandle === null)
            return;
        cancelFrame(frameHandle);
        frameHandle = null;
    }
    function schedule() {
        // A flush in progress owns the follow-up frame, so do not race it here.
        if (destroyed || flushing || frameHandle !== null || regions.size === 0)
            return;
        frameHandle = requestFrame(() => {
            frameHandle = null;
            flush();
        });
    }
    function flush() {
        if (flushing || regions.size === 0)
            return;
        // Swap in a fresh set first so marks made during onFlush accumulate for the
        // next frame instead of mutating the snapshot the listener is reading.
        const flushed = regions;
        regions = new Set();
        flushing = true;
        try {
            options.onFlush(flushed);
        }
        finally {
            flushing = false;
            // Also runs when onFlush threw, so work marked before the throw is not
            // stranded without a frame.
            schedule();
        }
    }
    return {
        cancel: () => {
            cancelFrameIfPending();
            regions.clear();
        },
        destroy: () => {
            if (destroyed)
                return;
            cancelFrameIfPending();
            regions.clear();
            destroyed = true;
        },
        get destroyed() {
            return destroyed;
        },
        flushNow: () => {
            if (destroyed)
                return;
            cancelFrameIfPending();
            flush();
        },
        mark: (region) => {
            if (destroyed)
                return;
            regions.add(region);
            schedule();
        },
        get pendingRegions() {
            return new Set(regions);
        },
        get scheduled() {
            return frameHandle !== null;
        },
    };
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
export function createMapKitHtmlSlotRenderer() {
    const written = new WeakMap();
    function write(element, html) {
        if (written.get(element) === html)
            return false;
        element.innerHTML = html;
        written.set(element, html);
        return true;
    }
    return {
        forget: (element) => {
            written.delete(element);
        },
        write,
        writeAll: (entries) => {
            let changed = 0;
            for (const entry of entries) {
                if (write(entry.element, entry.html))
                    changed += 1;
            }
            return changed;
        },
    };
}
function selectionOffset(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
export function createMapKitFocusPreserver(options) {
    function capture() {
        const active = options.activeElement();
        if (active === null || active === undefined)
            return null;
        const key = options.identify(active);
        if (key === null)
            return null;
        let selectionStart = null;
        let selectionEnd = null;
        try {
            const element = active;
            selectionStart = selectionOffset(element.selectionStart);
            selectionEnd = selectionOffset(element.selectionEnd);
        }
        catch {
            selectionStart = null;
            selectionEnd = null;
        }
        return { key, selectionEnd, selectionStart };
    }
    function restore(snapshot) {
        if (!snapshot)
            return false;
        const element = options.resolve(snapshot.key);
        if (!element?.focus)
            return false;
        element.focus({ preventScroll: true });
        if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
            try {
                element.setSelectionRange?.(snapshot.selectionStart, snapshot.selectionEnd);
            }
            catch {
                // Input type without a selection range; focus alone is the useful part.
            }
        }
        return true;
    }
    return {
        capture,
        preserve: (write) => {
            const snapshot = capture();
            try {
                return write();
            }
            finally {
                restore(snapshot);
            }
        },
        restore,
    };
}
//# sourceMappingURL=render.js.map