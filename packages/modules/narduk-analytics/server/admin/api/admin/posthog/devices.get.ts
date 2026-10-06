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

interface PosthogDevicesPayload {
  rows: Array<{
    device: string
    pageviews: number
    uniqueVisitors: number
    /** The device type was blank: unknown, not a device called "Unknown". */
    unknown?: boolean
  }>
}

interface PosthogDevicesResponse extends PosthogDevicesPayload {
  cached: boolean
  fetchedAt: string
  period: string
  traffic: string
}

export default defineEventHandler(async (event): Promise<PosthogDevicesResponse> => {
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const { window, traffic, noCache } = await readAnalyticsQuery(event)
  const cacheKey = `posthog:devices:${project.projectId}:${project.domain}:${window.key}:${traffic.key}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogDevicesPayload>(
      cacheKey,
      async (): Promise<PosthogDevicesPayload> => {
        const rows = await posthogRows(
          project,
          `
            SELECT
              nullIf(toString(properties.$device_type), '') AS device,
              count() AS pageviews,
              count(DISTINCT person_id) AS unique_visitors
            FROM events
            WHERE event = '$pageview'
              AND ${buildPosthogWindowClause(window)}
              ${buildPosthogCurrentUrlClause(project.domain)}
              ${buildPosthogTrafficClause(traffic)}
            GROUP BY device
            ORDER BY pageviews DESC
          `,
        )

        return {
          rows: rows.map((row) => {
            const device = row[0] === null || row[0] === undefined ? '' : String(row[0])
            return {
              device: device || 'Unknown',
              pageviews: posthogNumber(row[1]),
              uniqueVisitors: posthogNumber(row[2]),
              ...(device ? {} : { unknown: true }),
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
