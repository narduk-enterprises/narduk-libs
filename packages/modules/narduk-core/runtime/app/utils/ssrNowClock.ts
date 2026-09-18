// Explicit import (not a Nuxt auto-import): packed package consumers compile this file outside the owning Nuxt source tree, so Vue APIs must be explicit.
import { onBeforeUnmount, onMounted, readonly } from 'vue'

import type { Ref } from 'vue'

export interface SsrNowClockOptions {
  /**
   * After mount, re-read the browser clock every `tickMs` milliseconds. Omit
   * (or pass a non-positive / non-finite value) for a single update on mount.
   */
  tickMs?: number
}

/**
 * The lifecycle half of `useSsrNow()`, with the `useState` ref injected.
 *
 * `state` must already hold the server's reading (on the server) or the
 * hydrated payload value (on the client), so the first client render matches
 * the server's markup. After mount this switches the ref to the browser clock
 * — once on mount, then every `tickMs` if given — and clears the interval on
 * unmount. Call from component `setup()`.
 */
export function createSsrNowClock(
  state: Ref<number>,
  options: SsrNowClockOptions = {},
): Readonly<Ref<number>> {
  let timer: ReturnType<typeof setInterval> | undefined

  onMounted(() => {
    state.value = Date.now()
    const { tickMs } = options
    if (tickMs !== undefined && Number.isFinite(tickMs) && tickMs > 0) {
      timer = setInterval(() => {
        state.value = Date.now()
      }, tickMs)
    }
  })

  onBeforeUnmount(() => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  })

  return readonly(state)
}
