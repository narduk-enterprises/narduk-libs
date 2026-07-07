import type { NuxtError } from '#app'

import * as adminPosthog from '../types/adminPosthogDashboardTypes'

import type { MaybeRefOrGetter } from 'vue'

/** Re-export types for consumers on the composable import path; canonical definitions live in `app/types/adminPosthogDashboardTypes.ts`. */
export type {
  AdminPosthogEntryExitResponse,
  AdminPosthogInsightsResponse,
  AdminPosthogRecordingsResponse,
  AdminPosthogTableListResponse,
  AdminPosthogTableRow,
} from '../types/adminPosthogDashboardTypes'

export function useAdminPosthogDashboard(
  options: {
    keyPrefix?: string
    limit?: MaybeRefOrGetter<number | undefined>
    period?: MaybeRefOrGetter<string | undefined>
  } = {},
) {
  const keyPrefix = options.keyPrefix ?? adminPosthog.defaultPosthogDashboardKeyPrefix

  const period = computed(() => {
    const resolvedPeriod = toValue(options.period)
    return resolvedPeriod ?? '30d'
  })
  const limit = computed(() => {
    const resolvedLimit = toValue(options.limit)
    return resolvedLimit ?? 10
  })

  const pages = useAsyncData<adminPosthog.AdminPosthogTableListResponse>(
    () => `${keyPrefix}-pages`,
    async () =>
      await $fetch<adminPosthog.AdminPosthogTableListResponse>(adminPosthog.adminPosthogPagesApi, {
        params: { period: period.value },
      }),
    {
      default: () => ({ rows: [], cached: false, fetchedAt: '' }),
      watch: [period],
    },
  )

  const referrers = useAsyncData<adminPosthog.AdminPosthogTableListResponse>(
    () => `${keyPrefix}-referrers`,
    async () =>
      await $fetch<adminPosthog.AdminPosthogTableListResponse>(
        adminPosthog.adminPosthogReferrersApi,
        {
          params: { period: period.value },
        },
      ),
    {
      default: () => ({ rows: [], cached: false, fetchedAt: '' }),
      watch: [period],
    },
  )

  const devices = useAsyncData<adminPosthog.AdminPosthogTableListResponse>(
    () => `${keyPrefix}-devices`,
    async () =>
      await $fetch<adminPosthog.AdminPosthogTableListResponse>(
        adminPosthog.adminPosthogDevicesApi,
        {
          params: { period: period.value },
        },
      ),
    {
      default: () => ({ rows: [], cached: false, fetchedAt: '' }),
      watch: [period],
    },
  )

  const entryExit = useAsyncData<adminPosthog.AdminPosthogEntryExitResponse>(
    () => `${keyPrefix}-entry-exit`,
    async () =>
      await $fetch<adminPosthog.AdminPosthogEntryExitResponse>(
        adminPosthog.adminPosthogEntryExitApi,
        {
          params: { period: period.value },
        },
      ),
    {
      default: () => ({ entryPages: [], exitPages: [], cached: false, fetchedAt: '' }),
      watch: [period],
    },
  )

  const insights = useAsyncData<adminPosthog.AdminPosthogInsightsResponse>(
    () => `${keyPrefix}-insights`,
    async () =>
      await $fetch<adminPosthog.AdminPosthogInsightsResponse>(
        adminPosthog.adminPosthogInsightsApi,
        {
          params: { startDate: `-${period.value}` },
        },
      ),
    {
      default: () => ({ results: [], cached: false, fetchedAt: '', dateFrom: '', dateTo: '' }),
      watch: [period],
    },
  )

  const recordings = useAsyncData<adminPosthog.AdminPosthogRecordingsResponse | null, NuxtError>(
    () => `${keyPrefix}-recordings`,
    async () =>
      await $fetch<adminPosthog.AdminPosthogRecordingsResponse>(
        adminPosthog.adminPosthogRecordingsApi,
        {
          params: { limit: limit.value },
        },
      ),
    {
      default: () => null,
      watch: [limit],
    },
  )

  async function refreshAll() {
    await Promise.all([
      pages.refresh(),
      referrers.refresh(),
      devices.refresh(),
      entryExit.refresh(),
      insights.refresh(),
      recordings.refresh(),
    ])
  }

  return {
    period,
    limit,
    pages,
    referrers,
    devices,
    entryExit,
    insights,
    recordings,
    refreshAll,
  }
}
