import { computed, toValue, useAsyncData } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

const ADMIN_GA_OVERVIEW_API: string = '/api/admin/ga/overview'

export interface GaMetricValue {
  value: string
}

export interface GaDimensionValue {
  value: string
}

export interface AdminGaOverviewResponse {
  cached: boolean
  endDate: string
  fetchedAt: string
  rows: Array<{
    dimensionValues?: GaDimensionValue[]
    metricValues?: GaMetricValue[]
  }>
  startDate: string
  totals: GaMetricValue[]
}

const DEFAULT_GA_OVERVIEW_RESPONSE: AdminGaOverviewResponse = {
  totals: [],
  rows: [],
  startDate: '',
  endDate: '',
  cached: false,
  fetchedAt: '',
}

export function useAdminGaOverview(
  options: {
    endDate?: MaybeRefOrGetter<string | undefined>
    key?: string
    startDate?: MaybeRefOrGetter<string | undefined>
  } = {},
) {
  const params = computed(() => {
    const startDate = toValue(options.startDate)
    const endDate = toValue(options.endDate)

    return {
      startDate,
      endDate,
    }
  })

  return useAsyncData<AdminGaOverviewResponse>(
    () => `${options.key ?? 'layer-admin-ga-overview'}`,
    async () =>
      await $fetch<AdminGaOverviewResponse>(ADMIN_GA_OVERVIEW_API, {
        params: params.value,
      }),
    {
      default: () => DEFAULT_GA_OVERVIEW_RESPONSE,
      watch: [params],
    },
  )
}
