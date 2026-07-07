/**
 * useThrottledUpdates — buffers high-frequency updates and flushes at a
 * controlled rate to prevent excessive reactivity triggers.
 *
 * Designed for stores that ingest WebSocket / SSE / polling streams where
 * many updates arrive in quick succession (prices, notifications, presence).
 * The latest update for each key wins so stale intermediate values are
 * automatically discarded.
 *
 * This utility is pure TypeScript with no Vue dependencies so it can be
 * unit-tested without a Nuxt context. When used inside a Pinia store the
 * `onFlush` callback should update reactive state directly.
 *
 * @example
 * // In a Pinia store:
 * const { enqueue } = useThrottledUpdates<PriceData>({
 *   throttleMs: 250,                       // flush at most 4× per second
 *   getKey: (item) => item.symbol,         // dedup key within the buffer
 *   onFlush: (items) => applyUpdates(items),
 * })
 *
 * // When a WebSocket message arrives:
 * enqueue(msg.data)
 */
export function useThrottledUpdates<T>(options: {
  /** Return the deduplication key for an individual item. */
  getKey: (item: T) => string
  /** Called with the accumulated items when the buffer is flushed. */
  onFlush: (items: T[]) => void
  /**
   * Minimum milliseconds between flushes.
   * @default 250
   */
  throttleMs?: number
}) {
  let throttleMs = options.throttleMs ?? 250

  // Buffer holds the latest update per key (Map preserves insertion order).
  const buffer = new Map<string, T>()
  let lastFlushTime = 0
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null

  /**
   * Stage one or more items into the buffer and schedule a flush.
   * If multiple items share the same key, the last one wins.
   */
  function enqueue(items: T | T[]) {
    const list = Array.isArray(items) ? items : [items]
    for (const item of list) {
      buffer.set(options.getKey(item), item)
    }
    scheduleFlush()
  }

  function scheduleFlush() {
    if (pendingTimeout !== null) return // already scheduled

    const elapsed = Date.now() - lastFlushTime
    const delay =
      elapsed >= throttleMs
        ? 16 // ~1 frame — catch sibling messages arriving in the same tick
        : throttleMs - elapsed

    pendingTimeout = setTimeout(flush, delay)
  }

  /**
   * Immediately flush all buffered updates.
   * Called automatically by the scheduler; can also be called imperatively.
   */
  function flush() {
    if (pendingTimeout !== null) {
      clearTimeout(pendingTimeout)
      pendingTimeout = null
    }
    if (buffer.size === 0) return

    const items = Array.from(buffer.values())
    buffer.clear()
    lastFlushTime = Date.now()
    options.onFlush(items)
  }

  /** Change the throttle window at runtime (e.g. user adjusts update speed). */
  function setThrottleMs(ms: number) {
    throttleMs = ms
  }

  /** Discard all pending updates and cancel the scheduled flush. */
  function reset() {
    if (pendingTimeout !== null) {
      clearTimeout(pendingTimeout)
      pendingTimeout = null
    }
    buffer.clear()
    lastFlushTime = 0
  }

  return { enqueue, flush, reset, setThrottleMs }
}
