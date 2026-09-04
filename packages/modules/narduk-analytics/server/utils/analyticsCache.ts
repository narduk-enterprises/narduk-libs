/**
 * Per-isolate analytics response cache.
 *
 * Caches Google API responses (GA4, GSC) in Worker memory with a TTL.
 * Prevents data inconsistency from multiple rapid requests hitting different
 * API states, reduces Google API quota consumption, and improves response times.
 *
 * This is INTENTIONAL module-scope state: within a Worker isolate's lifetime,
 * the cache avoids redundant API calls. Not shared across isolates.
 */

interface CacheEntry<T> {
  data: T
  expiry: number
  fetchedAt: string
}

const cache = new Map<string, CacheEntry<unknown>>()

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get or fetch analytics data with per-isolate caching.
 * Returns cached data if valid, otherwise calls the fetcher and caches the result.
 */
export async function cachedAnalyticsFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ cached: boolean; data: T; fetchedAt: string }> {
  const existing = cache.get(key) as CacheEntry<T> | undefined

  if (existing && existing.expiry > Date.now()) {
    return { data: existing.data, cached: true, fetchedAt: existing.fetchedAt }
  }

  const data = await fetcher()
  const fetchedAt = new Date().toISOString()

  cache.set(key, { data, expiry: Date.now() + ttlMs, fetchedAt })

  // Evict stale entries periodically (keep cache bounded)
  if (cache.size > 50) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (v.expiry <= now) cache.delete(k)
    }
  }

  return { data, cached: false, fetchedAt }
}

/**
 * Resolve startDate/endDate from optional query params, with configurable defaults.
 * Includes date-swap protection for cases where start evaluates after end
 * (e.g. Vue reactivity tearing in SSR).
 *
 * @param defaultDays - How many days back for the default start date (default: 30). Pass 0 for "today only".
 */
export function resolveAnalyticsDateRange(
  params: { endDate?: string; startDate?: string },
  defaultDays = 30,
): { endDate: string; startDate: string } {
  let endDate = params.endDate ?? new Date().toISOString().split('T')[0]!

  let startDate: string
  if (params.startDate) {
    startDate = params.startDate
  } else if (defaultDays === 0) {
    startDate = endDate
  } else {
    const start = new Date(endDate)
    start.setDate(start.getDate() - defaultDays)
    startDate = start.toISOString().split('T')[0]!
  }

  if (startDate > endDate) {
    const temp = startDate
    startDate = endDate
    endDate = temp
  }

  return { startDate, endDate }
}
