// Explicit imports (not Nuxt auto-imports): the composable runs under isolated
// Vitest, where `#imports` is mocked and auto-imports are unavailable.
import { createLiveProduct } from '../utils/liveProduct'

import { useSsrNow } from './useSsrNow'

import type { LiveProductHandle, LiveProductOptions } from '../utils/liveProduct'

export interface UseLiveProductOptions extends LiveProductOptions {
  /**
   * `useSsrNow` key for the label's clock. Components that share a key share
   * one "now". Defaults to `'live-product'`.
   */
  clockKey?: string
  /** How often the "updated N min ago" label re-reads the clock. Defaults to 30 s. */
  labelTickMs?: number
}

export type UseLiveProductHandle = LiveProductHandle

/**
 * useLiveProduct — poll a live data product the way a viewer expects
 * (narduk-libs#374).
 *
 * The recommended replacement for a bare `useIntervalRefresh` whenever what is
 * refreshed is user-visible live content: it adds what every such consumer
 * re-derived on top of it --
 *
 * - polling pauses while the page is hidden, and refreshes at once on return
 *   when a poll fell due meanwhile;
 * - overlapping refreshes (a click during a tick) share one run;
 * - a hydration-safe "updated 5 minutes ago" label, read against `useSsrNow`
 *   rather than `new Date()`, which differs between server and client.
 *
 * It takes any refresh callback -- `refresh` from `useFetch`/`useAsyncData`,
 * a store action -- and fetches nothing itself. Call from component `setup()`.
 *
 * @example
 * ```ts
 * const { data, refresh } = await useFetch('/api/buoys/status')
 * const live = useLiveProduct(refresh, {
 *   intervalMs: 60_000,
 *   updatedAt: () => data.value?.observedAt,
 * })
 * // live.updatedAgo.value -> "3 minutes ago"; live.pending, live.error, live.refresh()
 * ```
 */
export function useLiveProduct(
  refresh: () => unknown,
  options: UseLiveProductOptions,
): UseLiveProductHandle {
  const { clockKey = 'live-product', labelTickMs = 30_000, ...liveOptions } = options
  return createLiveProduct(useSsrNow(clockKey, { tickMs: labelTickMs }), refresh, liveOptions)
}
