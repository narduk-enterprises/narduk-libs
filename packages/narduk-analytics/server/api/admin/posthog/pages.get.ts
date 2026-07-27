import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
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
}

export default defineEventHandler(async (event): Promise<PosthogPagesResponse> => {
  const log = useLogger(event).child('Analytics')
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const period = resolvePosthogPeriod(query.period)
  const domainClause = buildPosthogCurrentUrlClause(project.domain)
  const cacheKey = `posthog:pages:${project.projectId}:${project.domain}:${period.dateFrom}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogPagesPayload>(
      cacheKey,
      async (): Promise<PosthogPagesPayload> => {
        const response = await posthogQueryFetch<PosthogQueryResults>(project, {
          kind: 'HogQLQuery',
          query: `
            SELECT
              replaceRegexpAll(properties.$pathname, '\\\\?.*', '') AS page,
              count() AS pageviews,
              count(DISTINCT person_id) AS unique_visitors
            FROM events
            WHERE event = '$pageview'
              AND timestamp >= now() - ${period.intervalExpression}
              ${domainClause}
            GROUP BY page
            ORDER BY pageviews DESC
            LIMIT 20
          `,
        })

        return {
          rows: (response.results ?? []).map((row) => ({
            page: String(row[0] ?? '/'),
            pageviews: Number(row[1] ?? 0),
            uniqueVisitors: Number(row[2] ?? 0),
          })),
        }
      },
      query.noCache ? 0 : undefined,
    )

    log.debug('PostHog pages fetched', { cached, period: period.dateFrom })

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
