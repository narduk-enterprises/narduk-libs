import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { z } from 'zod'

import {
  buildPosthogCurrentUrlClause,
  POSTHOG_DEFAULT_PERIOD,
  posthogQueryFetch,
  type PosthogQueryResults,
  resolvePosthogPeriod,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'

const querySchema = z.object({
  period: z.string().optional().default(POSTHOG_DEFAULT_PERIOD),
  noCache: z.coerce.boolean().optional(),
})

interface PosthogDevicesPayload {
  rows: Array<{
    device: string
    pageviews: number
    uniqueVisitors: number
  }>
}

interface PosthogDevicesResponse extends PosthogDevicesPayload {
  cached: boolean
  fetchedAt: string
  period: string
}

export default defineEventHandler(async (event): Promise<PosthogDevicesResponse> => {
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const period = resolvePosthogPeriod(query.period)
  const domainClause = buildPosthogCurrentUrlClause(project.domain)
  const cacheKey = `posthog:devices:${project.projectId}:${project.domain}:${period.dateFrom}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogDevicesPayload>(
      cacheKey,
      async (): Promise<PosthogDevicesPayload> => {
        const response = await posthogQueryFetch<PosthogQueryResults>(project, {
          kind: 'HogQLQuery',
          query: `
            SELECT
              properties.$device_type AS device,
              count() AS pageviews,
              count(DISTINCT person_id) AS unique_visitors
            FROM events
            WHERE event = '$pageview'
              AND timestamp >= now() - ${period.intervalExpression}
              ${domainClause}
            GROUP BY device
            ORDER BY pageviews DESC
          `,
        })

        return {
          rows: (response.results ?? []).map((row) => ({
            device: String(row[0] ?? 'Unknown'),
            pageviews: Number(row[1] ?? 0),
            uniqueVisitors: Number(row[2] ?? 0),
          })),
        }
      },
      query.noCache ? 0 : undefined,
    )

    return {
      ...data,
      cached,
      fetchedAt,
      period: period.dateFrom,
    }
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number }
    throw createError({
      statusCode: err.status ?? err.statusCode ?? 500,
      statusMessage: `PostHog Error: ${err.message}`,
    })
  }
})
