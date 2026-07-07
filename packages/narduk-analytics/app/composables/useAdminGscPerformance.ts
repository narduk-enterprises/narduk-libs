import type { MaybeRefOrGetter } from 'vue'

const ADMIN_GSC_PERFORMANCE_API: string = '/api/admin/gsc/performance'

export const ADMIN_GSC_DIMENSIONS = [
  'query',
  'page',
  'device',
  'country',
  'searchAppearance',
] as const

export type AdminGscDimension = (typeof ADMIN_GSC_DIMENSIONS)[number]

export interface AdminGscPerformanceResponse {
  cached: boolean
  dimension: AdminGscDimension
  endDate: string
  fetchedAt: string
  rows: Array<{
    clicks: number
    ctr: number
    impressions: number
    keys: string[]
    position: number
  }>
  startDate: string
}

const DEFAULT_GSC_PERFORMANCE_RESPONSE: AdminGscPerformanceResponse = {
  rows: [],
  startDate: '',
  endDate: '',
  dimension: 'query',
  cached: false,
  fetchedAt: '',
}

export function useAdminGscPerformance(
  options: {
    dimension?: MaybeRefOrGetter<AdminGscDimension | undefined>
    endDate?: MaybeRefOrGetter<string | undefined>
    key?: string
    startDate?: MaybeRefOrGetter<string | undefined>
  } = {},
) {
  const params = computed(() => {
    const dimension = toValue(options.dimension)
    const startDate = toValue(options.startDate)
    const endDate = toValue(options.endDate)

    return {
      dimension: dimension ?? 'query',
      startDate,
      endDate,
    }
  })

  return useAsyncData<AdminGscPerformanceResponse>(
    () => `${options.key ?? 'layer-admin-gsc-performance'}`,
    async () =>
      await $fetch<AdminGscPerformanceResponse>(ADMIN_GSC_PERFORMANCE_API, {
        params: params.value,
      }),
    {
      default: () => DEFAULT_GSC_PERFORMANCE_RESPONSE,
      watch: [params],
    },
  )
}
