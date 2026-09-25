import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { z } from 'zod'

import {
  POSTHOG_DEFAULT_PERIOD,
  buildPosthogCurrentUrlHostMatch,
  posthogQueryFetch,
  resolvePosthogProjectConfig,
} from '#narduk-analytics-server/utils/posthog'
import { analyticsRuntimeConfig } from '#narduk-analytics-server/utils/runtimeConfig'

const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  noCache: z.coerce.boolean().optional(),
})

type PosthogInsightsPayload = Record<string, unknown> & {
  results?: unknown[]
}

type PosthogInsightsResponse = PosthogInsightsPayload & {
  cached: boolean
  dateFrom: string
  dateTo: string
  fetchedAt: string
}

export default defineEventHandler(async (event): Promise<PosthogInsightsResponse> => {
  const log = useLogger(event).child('Analytics')
  await requireAdmin(event)

  const config = analyticsRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const dateFrom = query.startDate ?? `-${POSTHOG_DEFAULT_PERIOD}`
  const dateTo = query.endDate === 'now' ? undefined : query.endDate
  const cacheKey = `posthog:insights:${project.projectId}:${project.domain}:${dateFrom}:${dateTo ?? 'now'}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogInsightsPayload>(
      cacheKey,
      async (): Promise<PosthogInsightsPayload> =>
        await posthogQueryFetch<PosthogInsightsPayload>(project, {
          kind: 'TrendsQuery',
          dateRange: {
            date_from: dateFrom,
            date_to: dateTo,
          },
          series: [
            { kind: 'EventsNode', event: '$pageview', math: 'total', name: 'Pageviews' },
            { kind: 'EventsNode', event: '$pageview', math: 'dau', name: 'Unique Visitors' },
          ],
          properties: {
            type: 'AND',
            values: [
              {
                type: 'AND',
                values: [{ type: 'hogql', key: buildPosthogCurrentUrlHostMatch(project.domain) }],
              },
            ],
          },
        }),
      query.noCache ? 0 : undefined,
    )

    log.debug('PostHog insights fetched', { cached, dateFrom, dateTo })

    return {
      ...data,
      cached,
      fetchedAt,
      dateFrom,
      dateTo: dateTo ?? 'now',
    }
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number }
    throw createError({
      statusCode: err.status ?? err.statusCode ?? 500,
      statusMessage: `PostHog Error: ${err.message}`,
    })
  }
})
