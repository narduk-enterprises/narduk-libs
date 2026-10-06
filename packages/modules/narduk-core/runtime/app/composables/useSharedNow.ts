// Explicit imports (not Nuxt auto-imports): the composable runs under isolated
// Vitest, where `#imports` is mocked and auto-imports are unavailable.
import { useNuxtApp, useState } from '#imports'

import { createSharedClock, createSharedClockRegistry } from '../utils/sharedClock'

import type { SharedClockRegistry } from '../utils/sharedClock'
import type { Ref } from 'vue'

/** The `useState` key the app's one clock hydrates under. */
export const SHARED_NOW_STATE_KEY = 'narduk:shared-now'

const REGISTRY = '_nardukSharedNow'

/**
 * useSharedNow — the app's one "now".
 *
 * Every relative age on a screen ("3 min ago", "open for 2 h", a running job's
 * elapsed time) should read the same instant, or two labels side by side
 * disagree. `useSsrNow(key)` gives one clock per key; this gives one clock per
 * app:
 *
 * - **Server:** reads `Date.now()` once into `useState('narduk:shared-now')`.
 * - **Hydration:** the client renders from that payload value, so the markup
 *   matches.
 * - **After mount:** takes the browser clock, then ticks at the FASTEST
 *   `cadenceMs` any mounted reader asked for (a reader without one only reads
 *   it; with none asking, the clock holds still). One timer serves every
 *   reader, it skips while the page is hidden, and the clock is re-read when
 *   the page becomes visible again.
 *
 * The reader registry lives on the Nuxt app, never at module level, so it is
 * safe under SSR. Call from component `setup()`.
 *
 * @example
 * ```ts
 * const now = useSharedNow(30_000) // tick at least every 30 s while mounted
 * const age = computed(() => formatAge(now.value - observedAt))
 * ```
 */
export function useSharedNow(cadenceMs?: number): Readonly<Ref<number>> {
  const nuxtApp = useNuxtApp() as unknown as Record<string, SharedClockRegistry | undefined>
  const registry = (nuxtApp[REGISTRY] ??= createSharedClockRegistry())
  return createSharedClock(
    useState<number>(SHARED_NOW_STATE_KEY, () => Date.now()),
    registry,
    cadenceMs,
  )
}
