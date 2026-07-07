// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- Required for isolated Vitest execution where Nuxt auto-imports are unavailable.
import { reactive } from 'vue'

/**
 * useRefCountedSubscription — reference-counted subscribe/unsubscribe with
 * an optional grace period for shared real-time channels.
 *
 * Multiple components can independently subscribe to the same channel key.
 * The actual `onSubscribe` callback fires only when the ref count transitions
 * from 0 → 1 (first subscriber). The `onUnsubscribe` callback fires only when
 * the ref count transitions from 1 → 0 (last subscriber), optionally after a
 * configurable grace period — which means a rapid unsub/resub pair (e.g.
 * navigating between pages) won't tear down and re-open the channel.
 *
 * All keys are normalized via the optional `normalizeKey` function so callers
 * don't need to worry about casing or whitespace inconsistencies.
 *
 * This utility uses Vue's `reactive()` for `refCounts` so mutations are
 * automatically tracked when used inside a Pinia setup store or Vue
 * templates. It can also be unit-tested outside of Nuxt context — just
 * stub `reactive` as an identity function in tests if needed.
 *
 * @example
 * // In a Pinia store:
 * const { subscribe, unsubscribe } = useRefCountedSubscription({
 *   onSubscribe: (keys) => streamStore.subscribe(keys.map(k => `price:${k}`)),
 *   onUnsubscribe: (keys) => streamStore.unsubscribe(keys.map(k => `price:${k}`)),
 *   gracePeriodMs: 2000,
 *   normalizeKey: (k) => k.toUpperCase().trim(),
 * })
 *
 * // In a component:
 * onMounted(() => subscribe(['AAPL', 'TSLA']))
 * onUnmounted(() => unsubscribe(['AAPL', 'TSLA']))
 */
export function useRefCountedSubscription(options: {
  /**
   * Milliseconds to wait before firing `onUnsubscribe` when the ref count
   * reaches 0. A pending unsub is cancelled if the same key is re-subscribed
   * within the grace window (e.g. page navigation).
   * @default 2000
   */
  gracePeriodMs?: number
  /**
   * Normalize a raw key before tracking. Defaults to identity.
   * @example (k) => k.toUpperCase().trim()
   */
  normalizeKey?: (key: string) => string
  /** Called with all keys whose ref count just became 1. */
  onSubscribe: (keys: string[]) => void
  /** Called with all keys whose ref count just reached 0. */
  onUnsubscribe: (keys: string[]) => void
}) {
  const gracePeriodMs = options.gracePeriodMs ?? 2000
  const normalize = options.normalizeKey ?? ((k: string) => k)

  // Reactive object — mutations trigger Vue reactivity and Pinia serialisation
  // when used as store state. Also readable as a plain snapshot in tests.
  const refCounts: Record<string, number> = reactive({})

  // Pending unsubscription timers (never serialized).
  const pendingUnsubscribes = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Subscribe to one or more keys.
   * Cancels any pending unsub grace timer for keys being re-subscribed.
   */
  function subscribe(rawKeys: string[]) {
    const newKeys: string[] = []

    for (const raw of rawKeys) {
      const key = normalize(raw)

      // Cancel pending unsubscription if within grace window.
      const timer = pendingUnsubscribes.get(key)
      if (timer !== undefined) {
        clearTimeout(timer)
        pendingUnsubscribes.delete(key)
      }

      const count = refCounts[key] ?? 0
      refCounts[key] = count + 1
      if (count === 0) newKeys.push(key)
    }

    if (newKeys.length > 0) options.onSubscribe(newKeys)
  }

  /**
   * Unsubscribe from one or more keys.
   * When a key's ref count reaches 0, schedules `onUnsubscribe` after the
   * grace period. Re-subscribing within the grace window cancels the timer.
   */
  function unsubscribe(rawKeys: string[]) {
    for (const raw of rawKeys) {
      const key = normalize(raw)
      const count = refCounts[key] ?? 0

      // Skip keys that were never subscribed — avoids spurious onUnsubscribe.
      if (count === 0) continue

      if (count === 1) {
        Reflect.deleteProperty(refCounts, key)

        // Cancel any existing timer for this key before scheduling a new one.
        const existing = pendingUnsubscribes.get(key)
        if (existing !== undefined) clearTimeout(existing)

        const timer = setTimeout(() => {
          pendingUnsubscribes.delete(key)
          options.onUnsubscribe([key])
        }, gracePeriodMs)

        pendingUnsubscribes.set(key, timer)
      } else {
        refCounts[key] = count - 1
      }
    }
  }

  /**
   * Cancel all pending timers and reset ref counts.
   * Call on logout or store reset.
   */
  function clear() {
    for (const timer of pendingUnsubscribes.values()) {
      clearTimeout(timer)
    }
    pendingUnsubscribes.clear()
    for (const key of Object.keys(refCounts)) {
      Reflect.deleteProperty(refCounts, key)
    }
  }

  return {
    subscribe,
    unsubscribe,
    clear,
    /** Reactive record of current ref counts per key. */
    refCounts,
  }
}
