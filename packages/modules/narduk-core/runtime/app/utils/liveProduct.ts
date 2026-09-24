// Explicit imports (not Nuxt auto-imports): packed package consumers compile this file outside the owning Nuxt source tree, and isolated Vitest has no auto-imports.
import {
  computed,
  type ComputedRef,
  type MaybeRefOrGetter,
  onBeforeUnmount,
  onMounted,
  readonly,
  type Ref,
  shallowRef,
  toValue,
} from 'vue'

import { formatRelative } from '../composables/useFormat'
import { useInFlightTracker } from '../composables/useInFlightTracker'
import { useIntervalRefresh } from '../composables/useIntervalRefresh'

export interface LiveProductOptions {
  /** Reactive switch for polling. Defaults to `true`. `refresh()` still works when off. */
  enabled?: MaybeRefOrGetter<boolean>
  /** Refresh once on mount, before the first tick. Defaults to `true`. */
  immediate?: boolean
  /** How often to poll while the page is visible. Reactive; non-positive stops polling. */
  intervalMs: MaybeRefOrGetter<number>
  /**
   * When the data itself was last updated -- an `observedAt` or `fetchedAt`
   * the product carries. Use it when the first data came from SSR, so the
   * label is right before the first client poll. Defaults to the time of the
   * last successful `refresh()`, which is `null` until one completes.
   */
  updatedAt?: MaybeRefOrGetter<Date | number | string | null | undefined>
}

export interface LiveProductHandle {
  /** The last refresh's failure, cleared by the next success. */
  error: Readonly<Ref<unknown>>
  /** Epoch ms of the last successful `refresh()`, or `null` before one. */
  lastRefreshedAt: Readonly<Ref<number | null>>
  /** A refresh is in flight. `false` on the server and on the hydrating render. */
  pending: Readonly<Ref<boolean>>
  /**
   * Refresh now. Overlapping calls -- a click during a tick, a tick during a
   * visibility return -- share the run already in flight instead of starting
   * another. Never rejects: a failure lands in `error`.
   */
  refresh: () => Promise<void>
  /**
   * "5 minutes ago" for `updatedAt` (or the last refresh), against the
   * render-safe clock, so the server and the hydrating client agree.
   * `null` when there is nothing to date yet.
   */
  updatedAgo: ComputedRef<string | null>
  /** The page is visible; polling is paused while it is not. */
  visible: Readonly<Ref<boolean>>
}

function toEpochMs(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * The lifecycle half of `useLiveProduct()`, with the render-safe clock
 * injected (narduk-libs#374). Call from component `setup()`: it registers
 * `onMounted` / `onBeforeUnmount`.
 *
 * Nothing runs until mount. The server renders the not-yet-refreshed state,
 * the client hydrates the same one, and only then does the first refresh
 * start -- a refresh started during setup would flip `pending` before the
 * hydrating render and mismatch the server's markup.
 *
 * While the page is hidden the interval is cleared (a background tab polling a
 * live product is traffic nobody reads). On return, if a poll fell due while
 * hidden, it refreshes at once and re-arms the interval; a return sooner than
 * that just re-arms it.
 */
export function createLiveProduct(
  now: Readonly<Ref<number>>,
  refreshProduct: () => unknown,
  options: LiveProductOptions,
): LiveProductHandle {
  const pending = shallowRef(false)
  const error = shallowRef<unknown>(null)
  const lastRefreshedAt = shallowRef<number | null>(null)
  const visible = shallowRef(true)
  const mounted = shallowRef(false)
  const inFlight = useInFlightTracker<null>()
  let lastStartedAt: number | null = null
  let armedAt: number | null = null

  async function refresh(): Promise<void> {
    await inFlight.dedupe('refresh', async () => {
      lastStartedAt = Date.now()
      pending.value = true
      try {
        await refreshProduct()
        lastRefreshedAt.value = Date.now()
        error.value = null
      } catch (caught: unknown) {
        error.value = caught
      } finally {
        pending.value = false
      }
      return null
    })
  }

  const enabled = (): boolean => toValue(options.enabled ?? true)

  useIntervalRefresh(refresh, options.intervalMs, {
    enabled: () => mounted.value && visible.value && enabled(),
  })

  function onVisibility(): void {
    const isVisible = document.visibilityState !== 'hidden'
    if (isVisible === visible.value) return
    visible.value = isVisible
    if (!isVisible || !enabled()) return
    const intervalMs = toValue(options.intervalMs)
    const origin = lastStartedAt ?? armedAt
    const skippedImmediate = (options.immediate ?? true) && lastStartedAt === null
    const intervalElapsed =
      origin !== null &&
      Number.isFinite(intervalMs) &&
      intervalMs > 0 &&
      Date.now() - origin >= intervalMs
    if (skippedImmediate || intervalElapsed) void refresh()
  }

  onMounted(() => {
    visible.value = document.visibilityState !== 'hidden'
    document.addEventListener('visibilitychange', onVisibility)
    mounted.value = true
    armedAt = Date.now()
    if ((options.immediate ?? true) && visible.value && enabled()) void refresh()
  })

  onBeforeUnmount(() => {
    mounted.value = false
    document.removeEventListener('visibilitychange', onVisibility)
  })

  const updatedAgo = computed(() => {
    const at =
      options.updatedAt === undefined
        ? lastRefreshedAt.value
        : toEpochMs(toValue(options.updatedAt))
    return at === null ? null : formatRelative(at, new Date(now.value))
  })

  return {
    error: readonly(error),
    lastRefreshedAt: readonly(lastRefreshedAt),
    pending: readonly(pending),
    refresh,
    updatedAgo,
    visible: readonly(visible),
  }
}
