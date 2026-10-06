import { computed } from '#imports'

import { adminFormatMoment, adminRangeLine } from '../utils/analyticsAdminRange'
import { adminBuildTiles, adminSourceChips } from '../utils/analyticsAdminTiles'

import type { AdminSourceFailure } from '../utils/analyticsAdminRange'
import type { AdminSourceState } from '../utils/analyticsAdminTiles'
import type { useAdminAnalytics } from './useAdminAnalytics'

export type AdminAnalyticsState = ReturnType<typeof useAdminAnalytics>

/** A resource as the tile and chip builders read it. Google is daily only: an hourly range has no data to ask for. */
export function adminSourceState<T>(
  resource: {
    data: { value: T | null }
    failure: { value: AdminSourceFailure | null }
    pending: { value: boolean }
  },
  dailyOnly = false,
): AdminSourceState<T> {
  return {
    dailyOnly,
    data: dailyOnly ? null : resource.data.value,
    failure: dailyOnly ? null : resource.failure.value,
    pending: resource.pending.value,
  }
}

/** What the page says about its sources: what was measured, how fresh, and why not. */
export function useAdminAnalyticsModel(a: AdminAnalyticsState) {
  const dailyOnly = computed(() => a.dates.value === null)
  const overview = computed(() => adminSourceState(a.overview))
  const ga = computed(() => adminSourceState(a.ga, dailyOnly.value))
  const gscSeries = computed(() => adminSourceState(a.searchSeries, dailyOnly.value))
  const searchRows = computed(() => adminSourceState(a.searchRows, dailyOnly.value))
  const current = computed(() => overview.value.data)

  const denied = computed(
    () => overview.value.failure === 'denied' || a.health.failure.value === 'denied',
  )
  const measured = computed(() => {
    if (overview.value.failure === 'not_configured') return { state: 'bad', text: 'Not measured' }
    if (current.value) return { state: 'ok', text: 'Measured' }
    if (overview.value.failure) return { state: 'bad', text: 'Unavailable' }
    return { state: 'muted', text: 'Loading' }
  })

  // Header: tracking health, its own read and never filtered by the page.
  const health = computed(() => {
    const read = a.health.data.value
    if (!read) {
      return a.health.failure.value
        ? { line: 'Tracking health could not be read.', state: 'muted', title: 'Unknown' }
        : { line: '', state: 'muted', title: 'Checking' }
    }
    const coverage =
      read.markedShare === null
        ? ''
        : ` · ${Math.round(read.markedShare * 100)}% of events carry a traffic marker`
    const state = read.state === 'tracking' ? 'ok' : read.state === 'silent' ? 'bad' : 'warn'
    return {
      line: `Last event ${adminFormatMoment(read.lastEventAt, a.zone.value)} · ${read.reason}${coverage}`,
      state,
      title: read.title,
    }
  })

  const tiles = computed(() =>
    adminBuildTiles({
      ga: ga.value,
      gscSeries: gscSeries.value,
      nowMs: a.clock.value,
      overview: overview.value,
      tz: a.zone.value,
    }),
  )
  const chips = computed(() =>
    adminSourceChips({
      ga: ga.value,
      gsc: gscSeries.value,
      nowMs: a.clock.value,
      overview: overview.value,
    }),
  )
  const rangeLine = computed(() =>
    current.value
      ? adminRangeLine(current.value.window.from, current.value.window.to, a.zone.value)
      : '',
  )

  // Stale: a refresh failed but the same range's last read is still on screen, or the page sat open.
  const staleBanner = computed(() => {
    const fetched = current.value?.fetchedAt
    if (overview.value.failure && current.value) {
      const at = fetched ? adminFormatMoment(fetched, a.zone.value) : ''
      return {
        body: `PostHog: ${a.overview.message.value}`,
        head: `Showing cached figures from ${at}`,
      }
    }
    const age = a.overviewFreshness.value
    if (age?.state === 'stale') {
      return { body: 'Refresh to read them again.', head: `These figures are ${age.age} old` }
    }
    return null
  })
  const errorBanner = computed(() =>
    overview.value.failure &&
    !current.value &&
    overview.value.failure !== 'not_configured' &&
    !denied.value
      ? a.overview.message.value
      : '',
  )
  const classesUnavailable = computed(() =>
    overview.value.failure && !current.value ? 'Traffic classes not measured.' : '',
  )

  const loadingOverview = computed(
    () => a.overview.pending.value || a.ga.pending.value || a.searchSeries.pending.value,
  )
  const refreshing = computed(() =>
    [
      a.overview,
      a.origins,
      a.pages,
      a.devices,
      a.entryExit,
      a.ga,
      a.searchSeries,
      a.searchRows,
    ].some((item) => item.pending.value),
  )
  const behaviorFailure = computed(
    () => a.pages.message.value || a.devices.message.value || a.entryExit.message.value,
  )

  return {
    behaviorFailure,
    chips,
    classesUnavailable,
    current,
    dailyOnly,
    denied,
    errorBanner,
    ga,
    gscSeries,
    health,
    loadingOverview,
    measured,
    overview,
    rangeLine,
    refreshing,
    searchRows,
    staleBanner,
    tiles,
  }
}
