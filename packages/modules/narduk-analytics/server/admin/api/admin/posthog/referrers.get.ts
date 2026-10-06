import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'

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

interface PosthogReferrersPayload {
  rows: Array<{
    referrer: string
    uniqueVisitors: number
    /** A blank referrer is unknown (direct, an app, a stripped header), not "direct". */
    unknown?: boolean
    visits: number
  }>
}

interface PosthogReferrersResponse extends PosthogReferrersPayload {
  cached: boolean
  fetchedAt: string
  period: string
  traffic: string
}

export default defineEventHandler(async (event): Promise<PosthogReferrersResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const { window, traffic, noCache } = await readAnalyticsQuery(event)
  const cacheKey = `posthog:referrers:${project.projectId}:${project.domain}:${window.key}:${traffic.key}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogReferrersPayload>(
      cacheKey,
      async (): Promise<PosthogReferrersPayload> => {
        const rows = await posthogRows(
          project,
          `
            SELECT
              coalesce(nullIf(properties.$referring_domain, ''), '') AS referrer,
              count() AS visits,
              count(DISTINCT person_id) AS unique_visitors
            FROM events
            WHERE event = '$pageview'
              AND ${buildPosthogWindowClause(window)}
              ${buildPosthogCurrentUrlClause(project.domain)}
              ${buildPosthogTrafficClause(traffic)}
            GROUP BY referrer
            ORDER BY visits DESC
            LIMIT 15
          `,
        )

        return {
          rows: rows.map((row) => {
            const referrer = row[0] === null || row[0] === undefined ? '' : String(row[0])
            return {
              referrer: referrer || '(no referrer)',
              visits: posthogNumber(row[1]),
              uniqueVisitors: posthogNumber(row[2]),
              ...(referrer ? {} : { unknown: true }),
            }
          }),
        }
      },
      analyticsCacheTtl(window, noCache),
    )

    return {
      ...data,
      cached,
      fetchedAt,
      period: window.label,
      traffic: traffic.key,
    }
  } catch (error: unknown) {
    throw posthogUpstreamError(error)
  }
})
