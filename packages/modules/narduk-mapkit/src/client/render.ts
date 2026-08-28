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
import { defaultMapKitFrameScheduler } from './timers.js'

import type { MapKitFrameScheduler } from './timers.js'

/** Receives the regions marked dirty since the previous flush. Never empty. */
export type MapKitRenderFlushListener = (regions: ReadonlySet<string>) => void

export interface MapKitRenderSchedulerOptions {
  cancelAnimationFrame?: MapKitFrameScheduler['cancelAnimationFrame']
  /** Run once per frame with the accumulated dirty regions. */
  onFlush: MapKitRenderFlushListener
  requestAnimationFrame?: MapKitFrameScheduler['requestAnimationFrame']
}

export interface MapKitRenderScheduler {
  /** Drop the pending frame and the dirty regions without flushing. */
  cancel: () => void
  /** Cancel and make the scheduler inert. Idempotent; `mark()` then no-ops. */
  destroy: () => void
  readonly destroyed: boolean
  /**
   * Flush synchronously instead of waiting for the frame, cancelling it. A
   * no-op when nothing is dirty, so it never fires an empty render.
   */
  flushNow: () => void
  /** Mark `region` dirty and schedule a flush if one is not already pending. */
  mark: (region: string) => void
  /** Snapshot of the regions waiting for the next flush. */
  readonly pendingRegions: ReadonlySet<string>
  /** Whether a frame is currently pending. */
  readonly scheduled: boolean
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
export function createMapKitRenderScheduler(
  options: MapKitRenderSchedulerOptions,
): MapKitRenderScheduler {
  const requestFrame = options.requestAnimationFrame ?? defaultMapKitFrameScheduler.requestAnimationFrame
  const cancelFrame = options.cancelAnimationFrame ?? defaultMapKitFrameScheduler.cancelAnimationFrame

  let regions = new Set<string>()
  let frameHandle: number | null = null
  let flushing = false
  let destroyed = false

  function cancelFrameIfPending(): void {
    if (frameHandle === null) return
    cancelFrame(frameHandle)
    frameHandle = null
  }

  function schedule(): void {
    // A flush in progress owns the follow-up frame, so do not race it here.
    if (destroyed || flushing || frameHandle !== null || regions.size === 0) return
    frameHandle = requestFrame(() => {
      frameHandle = null
      flush()
    })
  }

  function flush(): void {
    if (flushing || regions.size === 0) return
    // Swap in a fresh set first so marks made during onFlush accumulate for the
    // next frame instead of mutating the snapshot the listener is reading.
    const flushed = regions
    regions = new Set()
    flushing = true
    try {
      options.onFlush(flushed)
    } finally {
      flushing = false
      // Also runs when onFlush threw, so work marked before the throw is not
      // stranded without a frame.
      schedule()
    }
  }

  return {
    cancel: () => {
      cancelFrameIfPending()
      regions.clear()
    },
    destroy: () => {
      if (destroyed) return
      cancelFrameIfPending()
      regions.clear()
      destroyed = true
    },
    get destroyed(): boolean {
      return destroyed
    },
    flushNow: () => {
      if (destroyed) return
      cancelFrameIfPending()
      flush()
    },
    mark: (region: string) => {
      if (destroyed) return
      regions.add(region)
      schedule()
    },
    get pendingRegions(): ReadonlySet<string> {
      return new Set(regions)
    },
    get scheduled(): boolean {
      return frameHandle !== null
    },
  }
}

/**
 * The structural subset of an element the slot renderer writes to. A real
 * `HTMLElement` satisfies it, and so does `{ innerHTML: '' }` in a Node test.
 */
export interface MapKitHtmlSlotElement {
  innerHTML: string
}

export interface MapKitHtmlSlotEntry<TElement extends MapKitHtmlSlotElement> {
  element: TElement
  html: string
}

export interface MapKitHtmlSlotRenderer<TElement extends MapKitHtmlSlotElement> {
  /** Drop the remembered HTML for an element, e.g. once it is detached. */
  forget: (element: TElement) => void
  /** Write `html` unless the element already holds exactly it. Returns whether it wrote. */
  write: (element: TElement, html: string) => boolean
  /** Write several slots in one pass. Returns how many actually changed. */
  writeAll: (entries: Iterable<MapKitHtmlSlotEntry<TElement>>) => number
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
export function createMapKitHtmlSlotRenderer<
  TElement extends MapKitHtmlSlotElement = MapKitHtmlSlotElement,
>(): MapKitHtmlSlotRenderer<TElement> {
  const written = new WeakMap<TElement, string>()

  function write(element: TElement, html: string): boolean {
    if (written.get(element) === html) return false
    element.innerHTML = html
    written.set(element, html)
    return true
  }

  return {
    forget: (element) => {
      written.delete(element)
    },
    write,
    writeAll: (entries) => {
      let changed = 0
      for (const entry of entries) {
        if (write(entry.element, entry.html)) changed += 1
      }
      return changed
    },
  }
}

/**
 * The structural subset of a focused element the focus preserver reads and
 * restores. Declared structurally so it can be faked without a DOM.
 */
export interface MapKitFocusableElement {
  focus?: (options?: { preventScroll?: boolean }) => void
  selectionEnd?: number | null
  selectionStart?: number | null
  setSelectionRange?: (start: number, end: number) => void
}

/** What was focused before a batch of writes, addressed by stable key. */
export interface MapKitFocusSnapshot {
  readonly key: string
  readonly selectionEnd: number | null
  readonly selectionStart: number | null
}

export interface MapKitFocusPreserverOptions {
  /** The element holding focus right now, usually `() => document.activeElement`. */
  activeElement: () => unknown
  /**
   * Stable identity for an element that survives the rewrite -- an `id`, or a
   * `data-` attribute the render emits. Return `null` for anything not worth
   * restoring, which skips the whole capture.
   */
  identify: (element: unknown) => string | null
  /**
   * Find the element carrying `key` after the rewrite, usually a
   * `querySelector`. Return `null` when the slot no longer renders it.
   */
  resolve: (key: string) => MapKitFocusableElement | null
}

export interface MapKitFocusPreserver {
  /** Snapshot the focused element's key and selection, or `null` if none qualifies. */
  capture: () => MapKitFocusSnapshot | null
  /** Capture, run `write`, then restore -- including when `write` throws. */
  preserve: <TResult>(write: () => TResult) => TResult
  /** Re-focus the snapshot's key and reapply its selection. Returns whether it focused. */
  restore: (snapshot: MapKitFocusSnapshot | null) => boolean
}

function selectionOffset(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
export function createMapKitFocusPreserver(
  options: MapKitFocusPreserverOptions,
): MapKitFocusPreserver {
  function capture(): MapKitFocusSnapshot | null {
    const active = options.activeElement()
    if (active === null || active === undefined) return null
    const key = options.identify(active)
    if (key === null) return null

    let selectionStart: number | null = null
    let selectionEnd: number | null = null
    try {
      const element = active as MapKitFocusableElement
      selectionStart = selectionOffset(element.selectionStart)
      selectionEnd = selectionOffset(element.selectionEnd)
    } catch {
      selectionStart = null
      selectionEnd = null
    }

    return { key, selectionEnd, selectionStart }
  }

  function restore(snapshot: MapKitFocusSnapshot | null): boolean {
    if (!snapshot) return false
    const element = options.resolve(snapshot.key)
    if (!element?.focus) return false

    element.focus({ preventScroll: true })
    if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
      try {
        element.setSelectionRange?.(snapshot.selectionStart, snapshot.selectionEnd)
      } catch {
        // Input type without a selection range; focus alone is the useful part.
      }
    }
    return true
  }

  return {
    capture,
    preserve: (write) => {
      const snapshot = capture()
      try {
        return write()
      } finally {
        restore(snapshot)
      }
    },
    restore,
  }
}
