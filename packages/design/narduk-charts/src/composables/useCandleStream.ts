import { ref, type Ref } from 'vue'
import type { CandleBar } from '../types'

export interface CandleStreamOptions {
  /**
   * Soft cap on push frequency (uses `performance.now()` when available).
   */
  maxUpdatesPerSecond?: number
}

/**
 * Rolling buffer of OHLC bars for live charts. `pushBar` appends; when the last
 * bar shares the same open time (`t`) as the incoming bar, the last bar is replaced.
 */
export function useCandleStream(
  maxBars: number,
  initial: CandleBar[] = [],
  options?: CandleStreamOptions,
) {
  const bars: Ref<CandleBar[]> = ref(
    initial.length ? initial.slice(-maxBars) : [],
  )

  let lastPushMs: number | null = null

  function throttleOk() {
    const cap = options?.maxUpdatesPerSecond
    if (cap === undefined || cap <= 0) return true
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const minDt = 1000 / cap
    if (lastPushMs !== null && now - lastPushMs < minDt) return false
    lastPushMs = now
    return true
  }

  function pushBar(bar: CandleBar) {
    if (!throttleOk()) return
    const next = bars.value.slice()
    const last = next[next.length - 1]
    if (last && last.t === bar.t) {
      next[next.length - 1] = { ...bar }
    } else {
      next.push({ ...bar })
      while (next.length > maxBars) next.shift()
    }
    bars.value = next
  }

  /** Replace the trailing bar (e.g. same bucket still forming). */
  function updateLast(bar: CandleBar) {
    if (!throttleOk()) return
    const next = bars.value.slice()
    if (next.length === 0) {
      next.push({ ...bar })
    } else {
      next[next.length - 1] = { ...bar }
    }
    bars.value = next
  }

  function setBars(next: CandleBar[]) {
    bars.value = next.slice(-maxBars)
  }

  function clear() {
    bars.value = []
  }

  return { bars, pushBar, updateLast, setBars, clear }
}
