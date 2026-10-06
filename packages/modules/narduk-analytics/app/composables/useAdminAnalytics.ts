import { computed, onMounted, onScopeDispose, reactive, ref, useState } from '#imports'

import { adminAnalyticsApi } from '../types/adminAnalyticsTypes'
import {
  adminFreshness,
  adminLocalTimeZone,
  adminRangeDates,
  adminRangeDefaults,
  adminRangeQuery,
  adminResolveTimeZone,
  adminValidateCustomRange,
} from '../utils/analyticsAdminRange'

import { useAdminAnalyticsCustomRange } from './useAdminAnalyticsCustomRange'
import { useAdminAnalyticsResource } from './useAdminAnalyticsResource'

import type {
  AdminAnalyticsDevices,
  AdminAnalyticsEntryExit,
  AdminAnalyticsGa,
  AdminAnalyticsGsc,
  AdminAnalyticsHealth,
  AdminAnalyticsOriginDimension,
  AdminAnalyticsOrigins,
  AdminAnalyticsOverview,
  AdminAnalyticsPages,
} from '../types/adminAnalyticsTypes'
import type { AdminAnalyticsParams } from './useAdminAnalyticsResource'

export type AdminAnalyticsTab = 'behavior' | 'overview' | 'search'

const CLOCK_TICK_MS = 30_000

/** State and reads for the admin Analytics page: range, zone, traffic and every source. */
export function useAdminAnalytics() {
  const range = reactive(adminRangeDefaults())
  const tab = ref<AdminAnalyticsTab>('overview')
  const originDimension = ref<AdminAnalyticsOriginDimension>('channels')
  const searchDimension = ref<'page' | 'query'>('query')

  // The browser's zone is only known on the client; start on UTC so SSR and hydration agree.
  // The clock is read once on the server and handed to the client, then ticks after mount.
  const localZone = ref('UTC')
  const seed = useState('ne-admin-analytics-now', () => Date.now())
  const ticked = ref(0)
  const clock = computed(() => ticked.value || seed.value)
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    localZone.value = adminLocalTimeZone()
    ticked.value = Date.now()
    timer = setInterval(() => (ticked.value = Date.now()), CLOCK_TICK_MS)
  })
  onScopeDispose(() => clearInterval(timer))

  const zone = computed(() => adminResolveTimeZone(range.tz, localZone.value))
  const custom = useAdminAnalyticsCustomRange(
    range,
    () => clock.value,
    () => zone.value,
  )

  const query = computed<AdminAnalyticsParams>(() => {
    if (
      range.preset === 'custom' &&
      adminValidateCustomRange(range.start, range.end, clock.value, zone.value)
    ) {
      return null
    }
    return adminRangeQuery(range, localZone.value)
  })
  const dates = computed(() => adminRangeDates(range, clock.value, localZone.value))

  const onOverview = () => tab.value === 'overview'
  const onBehavior = () => tab.value === 'behavior'
  const onSearch = () => tab.value === 'search'
  const read = <T>(url: string, params: () => AdminAnalyticsParams, enabled: () => boolean) =>
    useAdminAnalyticsResource<T>(url, params, enabled)
  const googleParams = (extra: Record<string, string> = {}): AdminAnalyticsParams =>
    dates.value ? { ...dates.value, ...extra } : null

  const overview = read<AdminAnalyticsOverview>(
    adminAnalyticsApi.overview,
    () => query.value,
    onOverview,
  )
  const health = read<AdminAnalyticsHealth>(
    adminAnalyticsApi.health,
    () => ({}),
    () => true,
  )
  const origins = read<AdminAnalyticsOrigins>(
    adminAnalyticsApi.origins,
    () => (query.value ? { ...query.value, dimension: originDimension.value } : null),
    onOverview,
  )
  const pages = read<AdminAnalyticsPages>(adminAnalyticsApi.pages, () => query.value, onBehavior)
  const devices = read<AdminAnalyticsDevices>(
    adminAnalyticsApi.devices,
    () => query.value,
    onBehavior,
  )
  const entryExit = read<AdminAnalyticsEntryExit>(
    adminAnalyticsApi.entryExit,
    () => query.value,
    onBehavior,
  )
  const ga = read<AdminAnalyticsGa>(adminAnalyticsApi.ga, () => googleParams(), onOverview)
  const searchSeries = read<AdminAnalyticsGsc>(
    adminAnalyticsApi.gsc,
    () => googleParams({ dimension: 'date' }),
    onOverview,
  )
  const searchRows = read<AdminAnalyticsGsc>(
    adminAnalyticsApi.gsc,
    () => googleParams({ dimension: searchDimension.value }),
    onSearch,
  )

  const resources = [
    overview,
    health,
    origins,
    pages,
    devices,
    entryExit,
    ga,
    searchSeries,
    searchRows,
  ]
  const refreshAll = async () => {
    await Promise.all(resources.map((item) => item.load()))
  }

  const overviewFreshness = computed(() =>
    adminFreshness(overview.data.value?.fetchedAt, range.preset, clock.value),
  )

  return {
    ...custom,
    clock,
    dates,
    devices,
    entryExit,
    ga,
    health,
    localZone,
    originDimension,
    origins,
    overview,
    overviewFreshness,
    pages,
    range,
    refreshAll,
    searchDimension,
    searchRows,
    searchSeries,
    tab,
    zone,
  }
}
