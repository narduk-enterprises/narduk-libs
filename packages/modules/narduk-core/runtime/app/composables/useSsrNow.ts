// Explicit imports (not Nuxt auto-imports): the composable runs under isolated
// Vitest, where `#imports` is mocked and auto-imports are unavailable.
import { useState } from '#imports'

import { createSsrNowClock } from '../utils/ssrNowClock'

import type { SsrNowClockOptions } from '../utils/ssrNowClock'
import type { Ref } from 'vue'

export type UseSsrNowOptions = SsrNowClockOptions

/**
 * useSsrNow — a render-safe "now" for relative times ("33 min ago").
 *
 * Reading `Date.now()` during render is a hydration bug: the server and the
 * browser read it at different instants, so a relative age can straddle a
 * minute boundary and Vue reports a hydration mismatch. This composable reads
 * the clock once on the server into `useState('narduk:now:<key>')`; the client
 * hydrates with that same serialized value, so both renders agree. After mount
 * it switches to the browser clock (one update on mount, which also refreshes a
 * value left over from an earlier page on client-side navigation), then
 * optionally ticks every `tickMs`. The interval is cleared on unmount.
 *
 * Call it from component `setup()` — it registers `onMounted` /
 * `onBeforeUnmount`. Components that pass the same `key` share one value.
 *
 * @example
 * ```ts
 * const now = useSsrNow('station-page', { tickMs: 60_000 })
 * const age = computed(() => formatAge(now.value - observedAt))
 * ```
 */
export function useSsrNow(key: string, options: UseSsrNowOptions = {}): Readonly<Ref<number>> {
  return createSsrNowClock(
    useState<number>(`narduk:now:${key}`, () => Date.now()),
    options,
  )
}
