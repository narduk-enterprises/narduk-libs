/**
 * useInFlightTracker — singleton promise map for request deduplication.
 *
 * Prevents redundant parallel fetches for the same resource. When two
 * concurrent callers request the same key, the second caller receives the
 * same promise as the first rather than triggering a second network request.
 *
 * Intended for use inside Pinia stores and service functions. The tracker is
 * ephemeral (not reactive) — it only deduplicates concurrent in-flight calls,
 * not cached results.
 *
 * @example
 * // In a service file:
 * const portfolioTracker = useInFlightTracker<PortfolioResponse>()
 *
 * export async function fetchPortfolio(
 *   gameId: string,
 *   fetchFn: AppFetchFn,
 * ): Promise<PortfolioResponse | null> {
 *   return portfolioTracker.dedupe(gameId, async () => {
 *     try {
 *       return await fetchFn<PortfolioResponse>(`/api/games/${gameId}/portfolio`)
 *     } catch {
 *       return null
 *     }
 *   })
 * }
 */
export function useInFlightTracker<T>() {
  const inFlight = new Map<string, Promise<T | null>>()

  /**
   * Return the existing in-flight promise for `key` if one exists,
   * otherwise call `fn()`, store the resulting promise, and return it.
   * The promise is removed from the map automatically once it settles.
   */
  async function dedupe(key: string, fn: () => Promise<T | null>): Promise<T | null> {
    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = fn().finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }

  /** Clear all tracked promises (e.g. on logout or store reset). */
  function clear() {
    inFlight.clear()
  }

  return { dedupe, clear }
}
