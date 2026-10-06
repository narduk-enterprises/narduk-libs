import { computed } from '#imports'

import {
  adminDailyGoogleValues,
  adminGaDailyUsers,
  adminGaThrough,
  adminGscDailyClicks,
  adminGscSettledThrough,
} from '../utils/analyticsAdminTiles'

import type { AdminChartMetric } from '../components/admin/AdminAnalyticsChart.vue'
import type { AdminSourceState } from '../utils/analyticsAdminTiles'
import type { AdminAnalyticsState, useAdminAnalyticsModel } from './useAdminAnalyticsModel'

type Model = ReturnType<typeof useAdminAnalyticsModel>

const DAILY_ONLY = 'Google is daily only. Choose 7 d or longer.'

/** The series the chart can draw, and why one it cannot is off. A gap is `null`, never zero. */
export function useAdminAnalyticsChartData(a: AdminAnalyticsState, model: Model) {
  const slots = computed(() => model.current.value?.series ?? [])

  const metrics = computed<AdminChartMetric[]>(() => {
    const series = slots.value
    const daily = model.current.value?.bucket === '1d'
    const keys = series.map((point) => point.key)
    const gaDays = adminGaDailyUsers(model.ga.value.data?.rows ? model.ga.value.data : null)

    const google = (
      source: AdminSourceState<unknown>,
      byDay: Map<string, number>,
      through: string | null,
      failed: string,
    ): Pick<AdminChartMetric, 'disabledReason' | 'values'> => {
      if (!daily || source.dailyOnly) return { disabledReason: DAILY_ONLY, values: [] }
      if (source.failure) return { disabledReason: failed, values: [] }
      if (!source.data) return { values: keys.map(() => null) }
      return { values: adminDailyGoogleValues(keys, byDay, through) }
    }

    return [
      { id: 'pageviews', label: 'Pageviews', values: series.map((p) => p.pageviews) },
      { id: 'sessions', label: 'Sessions', values: series.map((p) => p.sessions) },
      {
        id: 'people',
        label: 'People',
        note: 'People are distinct within each bucket, so they do not add up across buckets: someone who visits on two days counts on both.',
        values: series.map((p) => p.visitors),
      },
      {
        id: 'ga-users',
        label: 'GA4 users',
        note: 'GA4 is not filtered by traffic class. Days GA4 has not published are left blank, not zero.',
        ...google(
          model.ga.value,
          gaDays,
          adminGaThrough(model.ga.value.data),
          'GA4 could not be read.',
        ),
      },
      {
        id: 'search-clicks',
        label: 'Search clicks',
        note: 'Search Console lags two to three days; unsettled days are left blank, not zero.',
        ...google(
          model.gscSeries.value,
          adminGscDailyClicks(model.gscSeries.value.data),
          adminGscSettledThrough(a.clock.value, a.zone.value),
          'Search Console could not be read.',
        ),
      },
    ]
  })

  const empty = computed(() => {
    if (model.overview.value.failure === 'not_configured') {
      return 'PostHog is not set up for this app, so there is nothing to draw.'
    }
    if (model.overview.value.failure) return `Not measured: ${a.overview.message.value}`
    return 'Nothing to draw for this range.'
  })

  return { empty, metrics, slots }
}
