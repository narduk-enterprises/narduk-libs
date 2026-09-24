// Explicit import (not a Nuxt auto-import): packed package consumers compile this file outside the owning Nuxt source tree, so Vue APIs must be explicit.
import { onBeforeUnmount, onMounted, readonly } from 'vue'

import type { Ref } from 'vue'

export interface SsrNowClockOptions {
  /**
   * After mount, re-read the browser clock every `tickMs` milliseconds, and
   * again whenever the page becomes visible (a background tab's timers are
   * throttled, so a returning viewer would otherwise read a stale age until
   * the next tick). Omit (or pass a non-positive / non-finite value) for a
   * single update on mount.
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
  const read = () => {
    state.value = Date.now()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') read()
  }

  onMounted(() => {
    read()
    const { tickMs } = options
    if (tickMs !== undefined && Number.isFinite(tickMs) && tickMs > 0) {
      timer = setInterval(read, tickMs)
      document.addEventListener('visibilitychange', onVisibility)
    }
  })

  onBeforeUnmount(() => {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return readonly(state)
}
