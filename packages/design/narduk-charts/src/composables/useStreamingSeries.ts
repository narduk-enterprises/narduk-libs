import { ref, type Ref } from 'vue'

export interface StreamingSeriesOptions {
  /**
   * Soft cap on push frequency (uses `performance.now()` when available).
   * Extra pushes within the interval are ignored.
   */
  maxUpdatesPerSecond?: number
}

/**
 * Rolling buffer of numeric samples for live charts (e.g. anemometer, metrics).
 * Push new readings; oldest values drop when length exceeds `maxPoints`.
 */
export function useStreamingSeries(
  maxPoints: number,
  initial: number[] = [],
  options?: StreamingSeriesOptions,
) {
  const values: Ref<number[]> = ref(
    initial.length ? initial.slice(-maxPoints) : [],
  )

  let lastPushMs: number | null = null

  function push(v: number) {
    const cap = options?.maxUpdatesPerSecond
    if (cap !== undefined && cap > 0) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const minDt = 1000 / cap
      if (lastPushMs !== null && now - lastPushMs < minDt) return
      lastPushMs = now
    }
    const next = values.value.slice()
    next.push(v)
    while (next.length > maxPoints) next.shift()
    values.value = next
  }

  /** Replace the window (still trimmed to `maxPoints`). */
  function setWindow(next: number[]) {
    values.value = next.slice(-maxPoints)
  }

  function clear() {
    values.value = []
  }

  return { values, push, setWindow, clear }
}
