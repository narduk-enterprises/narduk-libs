// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- Required for isolated Vitest execution where Nuxt auto-imports are unavailable.
import { type MaybeRefOrGetter, onScopeDispose, toValue, watch } from 'vue'

/**
 * useIntervalRefresh — generic interval-based poller for reactive UIs.
 *
 * Invokes `callback` every `intervalMs` milliseconds. The interval and an
 * optional `enabled` flag may be reactive (ref/getter) so callers can pause,
 * resume, or retune polling without re-mounting.
 *
 * SSR-safe: the composable is a no-op on the server. On the client it cleans
 * up the interval via `onScopeDispose`, so it works inside both component
 * setup() and standalone effect scopes.
 *
 * @example
 * ```ts
 * // In a component or Pinia setup store:
 * useIntervalRefresh(() => refresh(), 60_000)
 *
 * // Reactive interval + pause control:
 * const intervalMs = ref(30_000)
 * const enabled = computed(() => route.name === 'dashboard')
 * useIntervalRefresh(refresh, intervalMs, { enabled, immediate: true })
 * ```
 */
export interface UseIntervalRefreshOptions {
  /**
   * Reactive switch that controls whether the interval is active.
   * When it flips to `false` the timer is cleared; flipping back to `true`
   * re-arms it with the current `intervalMs` value. Defaults to `true`.
   */
  enabled?: MaybeRefOrGetter<boolean>
  /** Invoke `callback` immediately on mount in addition to each interval tick. */
  immediate?: boolean
}

export interface UseIntervalRefreshHandle {
  /** Manually (re)start the interval with the current `intervalMs` value. */
  start: () => void
  /** Clear the running interval. Safe to call when nothing is scheduled. */
  stop: () => void
}

/**
 * Invoke the refresh callback and surface any sync throw or async rejection
 * via the logger instead of letting rejected promises become global
 * unhandledRejection events. We preserve synchronous invocation (no
 * microtask defer) so callers relying on same-tick side effects keep working.
 */
function runGuardedCallback(callback: () => void | Promise<void>): void {
  try {
    const result = callback()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch((error: unknown) => {
        // No shared logger is available on this code path; mirror the
        // module-prefix console convention used elsewhere in layers/core/app.
        console.error('[useIntervalRefresh] refresh callback failed:', error)
      })
    }
  } catch (error: unknown) {
    console.error('[useIntervalRefresh] refresh callback failed:', error)
  }
}

export function useIntervalRefresh(
  callback: () => void | Promise<void>,
  intervalMs: MaybeRefOrGetter<number>,
  options: UseIntervalRefreshOptions = {},
): UseIntervalRefreshHandle {
  if (import.meta.server) {
    return { start: () => {}, stop: () => {} }
  }

  let timerId: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  function start() {
    stop()
    const ms = toValue(intervalMs)
    if (!Number.isFinite(ms) || ms <= 0) return
    timerId = setInterval(() => {
      runGuardedCallback(callback)
    }, ms)
  }

  const enabledSource: MaybeRefOrGetter<boolean> = options.enabled ?? true
  watch(
    [() => toValue(intervalMs), () => toValue(enabledSource)],
    ([, isEnabled]) => {
      if (isEnabled) {
        start()
      } else {
        stop()
      }
    },
    { immediate: true },
  )

  // `immediate` must still respect `enabled`: callers that pass
  // `{ enabled: false, immediate: true }` are asking to pause polling until
  // the flag flips, so a mount-time refresh would break that contract and
  // fire unwanted API calls on views that are intentionally disabled.
  const enabledAtMount = toValue(enabledSource)
  if (options.immediate && enabledAtMount) {
    runGuardedCallback(callback)
  }

  onScopeDispose(stop)

  return { start, stop }
}
