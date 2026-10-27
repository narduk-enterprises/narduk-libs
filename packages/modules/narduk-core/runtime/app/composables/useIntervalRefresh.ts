// Explicit import (not a Nuxt auto-import): required for isolated Vitest execution where Nuxt auto-imports are unavailable.
import { type MaybeRefOrGetter, onScopeDispose, shallowRef, toValue, watch } from 'vue'

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
 *
 * // No reads from a background tab; one catch-up read on return:
 * useIntervalRefresh(refresh, 30_000, { pauseWhenHidden: true })
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
  /**
   * Stop the timer while the page is hidden (`document.visibilityState`), so
   * a background tab makes no requests. On return the callback runs at once if
   * a full interval has passed since it last ran (or since the timer started),
   * then the timer re-arms. Still subject to `enabled`. Defaults to `false`.
   */
  pauseWhenHidden?: boolean
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

  /** When the callback last ran, or the timer last started: the catch-up clock. */
  let lastRunAt = Date.now()

  function tick() {
    lastRunAt = Date.now()
    runGuardedCallback(callback)
  }

  function start() {
    stop()
    const ms = toValue(intervalMs)
    if (!Number.isFinite(ms) || ms <= 0) return
    timerId = setInterval(tick, ms)
  }

  const enabledSource: MaybeRefOrGetter<boolean> = options.enabled ?? true
  const visible = shallowRef(true)
  const watchVisibility = Boolean(options.pauseWhenHidden) && typeof document !== 'undefined'
  const onVisibility = () => {
    const now = document.visibilityState !== 'hidden'
    if (now === visible.value) return
    // Catch up before the watcher re-arms, so the new timer counts from this read.
    if (now && toValue(enabledSource) && Date.now() - lastRunAt >= toValue(intervalMs)) tick()
    visible.value = now
  }
  if (watchVisibility) {
    visible.value = document.visibilityState !== 'hidden'
    document.addEventListener('visibilitychange', onVisibility)
  }
  onScopeDispose(() => {
    if (watchVisibility) document.removeEventListener('visibilitychange', onVisibility)
  })

  watch(
    [() => toValue(intervalMs), () => toValue(enabledSource), visible],
    ([, isEnabled, isVisible]) => {
      if (isEnabled && isVisible) {
        if (timerId === null) lastRunAt = Date.now()
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
    tick()
  }

  onScopeDispose(stop)

  return { start, stop }
}
