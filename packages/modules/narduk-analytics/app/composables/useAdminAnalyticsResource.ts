import { ref, watch } from '#imports'

import { adminClassifyFailure, adminErrorText } from '../utils/analyticsAdminRange'

import type { AdminSourceFailure } from '../utils/analyticsAdminRange'

export interface AdminAnalyticsResource<T> {
  /** The last good response for the current query, kept across a failed refresh. */
  data: { value: T | null }
  error: { value: unknown }
  failure: { value: AdminSourceFailure | null }
  load: () => Promise<void>
  message: { value: string }
  pending: { value: boolean }
}

export type AdminAnalyticsParams = Record<string, string> | null

// `$fetch` types a known route's answer from the Nitro route map, which these shared reads
// are not part of in a consuming app; the page types each answer itself.
type FetchJson = <R>(url: string, options: { query: Record<string, string> }) => Promise<R>

/**
 * One admin read. It loads when `params` is non-null and `enabled`, keeps the
 * last good response for the same query when a refresh fails (so the page can
 * stamp it stale rather than blank it), and drops it when the query changed:
 * old figures under a new range's label would be a lie.
 */
export function useAdminAnalyticsResource<T>(
  url: string,
  params: () => AdminAnalyticsParams,
  enabled: () => boolean,
) {
  const data = ref<T | null>(null) as { value: T | null }
  const error = ref<unknown>(null)
  // Pending from the first render when a read is due, so the server's markup (which never fetches) matches the client's.
  const pending = ref(Boolean(params() && enabled()))
  const failure = ref<AdminSourceFailure | null>(null)
  const message = ref('')
  let goodKey = ''
  let run = 0

  const keyOf = (value: AdminAnalyticsParams) => (value ? JSON.stringify(value) : '')

  async function load() {
    const query = params()
    if (!query || !enabled()) return
    const key = keyOf(query)
    const mine = ++run
    // A new query is a new answer: figures for the old range must not sit under the new label.
    if (goodKey !== key) data.value = null
    pending.value = true
    try {
      const response = await ($fetch as unknown as FetchJson)<T>(url, { query })
      if (mine !== run) return
      data.value = response
      goodKey = key
      error.value = null
      failure.value = null
      message.value = ''
    } catch (caught: unknown) {
      if (mine !== run) return
      error.value = caught
      failure.value = adminClassifyFailure(caught)
      message.value = adminErrorText(caught)
    } finally {
      if (mine === run) pending.value = false
    }
  }

  watch(
    () => [keyOf(params()), enabled()] as const,
    () => {
      if (import.meta.client) void load()
    },
    { immediate: true },
  )

  return { data, error, failure, load, message, pending } as unknown as AdminAnalyticsResource<T>
}
