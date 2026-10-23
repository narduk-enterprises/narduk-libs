/**
 * useTimeAgo() — a live "3 minutes ago" that stays true without a timer per
 * row.
 *
 * ```ts
 * const ago = useTimeAgo(() => notification.createdAt, { timeZone: 'America/New_York' })
 * ago.text.value      // '3 minutes ago'; 'Mar 8, 2026' once it is over a week old
 * ago.absolute.value  // 'Mar 8, 2026, 3:30 PM EST', for a tooltip
 * ago.iso.value       // '2026-03-08T20:30:00.000Z', for <time datetime>
 * ```
 *
 * ## One ticker for every instance
 *
 * A feed of 200 rows must not own 200 intervals. All instances share one clock
 * (`NE_TIME_AGO_TICK_MS`, 30 seconds): the first mounted instance starts a
 * single `setInterval`, the last one to unmount stops it, and the clock also
 * catches up the moment a hidden tab becomes visible, since a background tab's
 * timers are throttled. Nothing ticks while no `useTimeAgo` is alive.
 *
 * ## House date rules
 *
 * - **Relative for live data**, through `formatRelative` (`./format`): "just
 *   now"-scale seconds, minutes, hours, calendar days, then weeks.
 * - **Absolute once it is more than a week old** (`absoluteAfter`, default
 *   `NE_TIME_AGO_ABSOLUTE_AFTER_MS`), through `formatDate`: a week-old "1 week
 *   ago" tells a reader less than the date does. A future value follows the same
 *   window, mirrored.
 * - The **absolute title** always carries the zone's own name (`CST`), through
 *   `formatDateTime`.
 *
 * ## SSR
 *
 * `./format` never reads the ambient clock or the host zone, and neither does
 * this: `timeZone` is required and is a decision (the market's zone, `'UTC'`),
 * never the browser's. The clock itself is the one thing that differs between
 * the server render and hydration; `NeRelativeTime` marks its text as allowed
 * to differ (`data-allow-mismatch="text"`), and a caller rendering this
 * composable's `text` itself should do the same. Pass `now` for a fixed instant
 * (a snapshot from the server, or a test) and the clock is not consulted at all.
 *
 * The ticker is client-only. On the server, and outside any component or effect
 * scope, no timer starts and the value is computed once from the ambient clock.
 */
import { computed, getCurrentScope, onScopeDispose, shallowRef, toValue } from 'vue'

import { formatDate, formatDateTime, formatRelative, instantOf } from '../../format'

import type { NeDateInput } from '../../format'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

/** The shared clock's period: one tick for every instance on the page. */
export const NE_TIME_AGO_TICK_MS = 30_000

/** Past this distance from `now`, the text is a date rather than a relative phrase. */
export const NE_TIME_AGO_ABSOLUTE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export interface NeTimeAgoOptions {
  /**
   * IANA zone for the date and the day arithmetic. Required, as in `./format`.
   * Every option here may be a value, a ref or a getter; only whether `now` is
   * given is decided once, at setup (it chooses whether to join the ticker).
   */
  timeZone: MaybeRefOrGetter<string>
  /** BCP-47 tag. Default `en-US`, as in `./format`. */
  locale?: MaybeRefOrGetter<string | undefined>
  /**
   * A fixed instant to measure against instead of the shared clock: a value,
   * ref or getter. Use it for a server snapshot or a test.
   */
  now?: MaybeRefOrGetter<NeDateInput>
  /**
   * Milliseconds from `now` beyond which the text is an absolute date.
   * Default `NE_TIME_AGO_ABSOLUTE_AFTER_MS` (7 days). `Infinity` is always
   * relative; `0` is always absolute.
   */
  absoluteAfter?: MaybeRefOrGetter<number | undefined>
  /** Rendered when the value is missing or unparseable. Default `—`. */
  empty?: MaybeRefOrGetter<string | undefined>
}

export interface NeTimeAgo {
  /** The visible text: relative while recent, a date after `absoluteAfter`. */
  text: ComputedRef<string>
  /** The full date, time and zone name, for a `title` tooltip. */
  absolute: ComputedRef<string>
  /** The instant as an ISO-8601 string for `<time datetime>`; `undefined` if unusable. */
  iso: ComputedRef<string | undefined>
  /** `true` while `text` is relative (so it will keep changing). */
  relative: ComputedRef<boolean>
}

/* -------------------------------------------------------------------------- */
/* The shared clock                                                            */
/* -------------------------------------------------------------------------- */

const clock = shallowRef(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | undefined

function refreshClock(): void {
  clock.value = Date.now()
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') refreshClock()
}

function subscribe(): void {
  subscribers += 1
  // A module-level clock that nobody was ticking is as old as the last
  // unsubscribe; bring it up to date before the first render reads it. A fresh
  // join against a running ticker is at most one period stale, which is within
  // the display's own resolution, so it does not rewrite the clock (and wake
  // every other instance) per mounted row.
  if (subscribers === 1) refreshClock()
  if (subscribers !== 1) return
  timer = setInterval(refreshClock, NE_TIME_AGO_TICK_MS)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
}

function unsubscribe(): void {
  subscribers -= 1
  if (subscribers > 0) return
  subscribers = 0
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** How many instances currently share the ticker. Exposed for tests and diagnostics. */
export function timeAgoSubscriberCount(): number {
  return subscribers
}

/* -------------------------------------------------------------------------- */
/* The composable                                                              */
/* -------------------------------------------------------------------------- */

export function useTimeAgo(
  value: MaybeRefOrGetter<NeDateInput>,
  options: NeTimeAgoOptions,
): NeTimeAgo {
  const usesSharedClock = options.now === undefined
  // Client only, and only where there is a scope to stop the subscription in.
  const joined = usesSharedClock && typeof window !== 'undefined' && getCurrentScope() !== undefined
  if (joined) subscribe()
  // Registered unconditionally (`true`: stay quiet outside a scope) so the hook
  // order never depends on the branch above.
  onScopeDispose(() => {
    if (joined) unsubscribe()
  }, true)

  const instant = computed(() => instantOf(toValue(value)))
  const now = computed(() => {
    if (!usesSharedClock) return instantOf(toValue(options.now))
    // No window: a server render. Read the clock fresh, once, rather than the
    // module-load value.
    return typeof window === 'undefined' ? Date.now() : clock.value
  })
  const shared = computed(() => ({
    timeZone: toValue(options.timeZone),
    locale: toValue(options.locale),
    empty: toValue(options.empty),
  }))

  const relative = computed(() => {
    if (instant.value === undefined || now.value === undefined) return false
    return (
      Math.abs(instant.value - now.value) <=
      (toValue(options.absoluteAfter) ?? NE_TIME_AGO_ABSOLUTE_AFTER_MS)
    )
  })

  const text = computed(() => {
    if (instant.value === undefined || now.value === undefined) return toValue(options.empty) ?? '—'
    return relative.value
      ? formatRelative(instant.value, { ...shared.value, now: now.value })
      : formatDate(instant.value, shared.value)
  })

  return {
    text,
    relative,
    absolute: computed(() =>
      formatDateTime(instant.value, { ...shared.value, timeZoneName: 'short' }),
    ),
    iso: computed(() =>
      instant.value === undefined ? undefined : new Date(instant.value).toISOString(),
    ),
  }
}
