/**
 * Polling that respects the reader: asks again only while the tab is visible,
 * never runs two requests at once, asks straight away when the tab comes back,
 * and throws away an answer that belongs to something the page has since left.
 *
 * Built for live vehicle feeds (every ~15 s), but it is just a polite loop.
 * Plain TypeScript with injectable timers, so it is tested without a clock.
 * Wire `visibilityChanged` to the document's `visibilitychange` event.
 */
import { defaultMapKitTimerScheduler } from './timers.js'

import type { MapKitTimerScheduler } from './timers.js'

export interface MapKitPollerOptions<T> {
  intervalMs: number
  /** Whether the page is on screen. Default: the document is not hidden. */
  isVisible?: () => boolean
  /** A request failed. The poll goes on at the normal interval. Default: ignored. */
  onError?: (error: unknown) => void
  /** Receives each answer, unless the poller was restarted or stopped while it was in flight. */
  onResult: (result: T) => void
  run: () => Promise<T>
  timers?: MapKitTimerScheduler
}

export interface MapKitPoller {
  /** Drop the in-flight answer and ask again now (the thing being polled changed). */
  restart: () => void
  start: () => void
  stop: () => void
  /** Call when the document's visibility changes. */
  visibilityChanged: () => void
}

export function createMapKitPoller<T>(options: MapKitPollerOptions<T>): MapKitPoller {
  const isVisible = options.isVisible ?? (() => globalThis.document?.visibilityState !== 'hidden')
  const timers = options.timers ?? defaultMapKitTimerScheduler
  let running = false
  let busy = false
  let epoch = 0
  let timer: unknown

  function clear(): void {
    if (timer !== undefined) timers.cancel(timer)
    timer = undefined
  }

  function schedule(): void {
    clear()
    // Hidden: no timer at all. visibilityChanged() starts the next request when the tab returns.
    if (running && isVisible()) timer = timers.schedule(() => void tick(), options.intervalMs)
  }

  async function tick(): Promise<void> {
    clear()
    if (!running || busy || !isVisible()) return
    busy = true
    const mine = epoch
    try {
      const result = await options.run()
      if (mine === epoch && running) options.onResult(result)
    } catch (error) {
      if (mine === epoch && running) options.onError?.(error)
    } finally {
      busy = false
      // A restart during the request already asked for another; otherwise schedule the next.
      if (running && mine === epoch) schedule()
      else if (running) void tick()
    }
  }

  return {
    restart() {
      if (!running) return
      epoch++
      clear()
      if (!busy) void tick()
    },
    start() {
      if (running) return
      running = true
      void tick()
    },
    stop() {
      running = false
      epoch++
      clear()
    },
    visibilityChanged() {
      if (!running) return
      if (isVisible()) {
        if (!busy) void tick()
      } else clear()
    },
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapKitMapLimit<A, B>(
  items: readonly A[],
  limit: number,
  fn: (item: A, index: number) => Promise<B>,
): Promise<B[]> {
  const out = new Array<B>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index] as A, index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()),
  )
  return out
}
