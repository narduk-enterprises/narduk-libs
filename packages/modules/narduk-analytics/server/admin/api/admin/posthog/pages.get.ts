import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'

import {
  buildPosthogCurrentUrlClause,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'
import {
  analyticsCacheTtl,
  buildPosthogTrafficClause,
  buildPosthogWindowClause,
  posthogNumber,
  posthogRows,
  posthogUpstreamError,
  readAnalyticsQuery,
} from '#narduk-analytics-server/utils/posthogQuery'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

interface PosthogPagesPayload {
  rows: Array<{
    page: string
    pageviews: number
    uniqueVisitors: number
  }>
}

interface PosthogPagesResponse extends PosthogPagesPayload {
  cached: boolean
  fetchedAt: string
  period: string
  traffic: string
  window: { from: string; label: string; to: string; tz: string }
}

export default defineEventHandler(async (event): Promise<PosthogPagesResponse> => {
  const log = useLogger(event).child('Analytics')
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const { window, traffic, noCache } = await readAnalyticsQuery(event)
  const cacheKey = `posthog:pages:${project.projectId}:${project.domain}:${window.key}:${traffic.key}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogPagesPayload>(
      cacheKey,
      async (): Promise<PosthogPagesPayload> => {
        const rows = await posthogRows(
          project,
          `
            SELECT
              replaceRegexpAll(properties.$pathname, '\\\\?.*', '') AS page,
              count() AS pageviews,
              count(DISTINCT person_id) AS unique_visitors
            FROM events
            WHERE event = '$pageview'
              AND ${buildPosthogWindowClause(window)}
              ${buildPosthogCurrentUrlClause(project.domain)}
              ${buildPosthogTrafficClause(traffic)}
            GROUP BY page
            ORDER BY pageviews DESC
            LIMIT 20
          `,
        )

        return {
          rows: rows.map((row) => ({
            page: String(row[0] ?? '/'),
            pageviews: posthogNumber(row[1]),
            uniqueVisitors: posthogNumber(row[2]),
          })),
        }
      },
      analyticsCacheTtl(window, noCache),
    )

    log.debug('PostHog pages fetched', { cached, window: window.label })

    return {
      ...data,
      cached,
      fetchedAt,
      period: window.label,
      traffic: traffic.key,
      window: { from: window.fromIso, to: window.toIso, tz: window.tz, label: window.label },
    }
  } catch (error: unknown) {
    throw posthogUpstreamError(error)
  }
})
