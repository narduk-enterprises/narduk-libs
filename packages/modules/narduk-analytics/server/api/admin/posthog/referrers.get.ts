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

interface PosthogReferrersPayload {
  rows: Array<{
    referrer: string
    uniqueVisitors: number
    visits: number
  }>
}

interface PosthogReferrersResponse extends PosthogReferrersPayload {
  cached: boolean
  fetchedAt: string
  period: string
}

export default defineEventHandler(async (event): Promise<PosthogReferrersResponse> => {
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const period = resolvePosthogPeriod(query.period)
  const domainClause = buildPosthogCurrentUrlClause(project.domain)
  const cacheKey = `posthog:referrers:${project.projectId}:${project.domain}:${period.dateFrom}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogReferrersPayload>(
      cacheKey,
      async (): Promise<PosthogReferrersPayload> => {
        const response = await posthogQueryFetch<PosthogQueryResults>(project, {
          kind: 'HogQLQuery',
          query: `
            SELECT
              coalesce(nullIf(properties.$referring_domain, ''), '(direct)') AS referrer,
              count() AS visits,
              count(DISTINCT person_id) AS unique_visitors
            FROM events
            WHERE event = '$pageview'
              AND timestamp >= now() - ${period.intervalExpression}
              ${domainClause}
            GROUP BY referrer
            ORDER BY visits DESC
            LIMIT 15
          `,
        })

        return {
          rows: (response.results ?? []).map((row) => ({
            referrer: String(row[0] ?? '(direct)'),
            visits: Number(row[1] ?? 0),
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
