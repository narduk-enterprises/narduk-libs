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

interface PosthogEntryExitPage {
  count: number
  page: string
}

interface PosthogEntryExitPayload {
  entryPages: PosthogEntryExitPage[]
  exitPages: PosthogEntryExitPage[]
}

interface PosthogEntryExitResponse extends PosthogEntryExitPayload {
  cached: boolean
  fetchedAt: string
  period: string
}

export default defineEventHandler(async (event): Promise<PosthogEntryExitResponse> => {
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const project = resolvePosthogProjectConfig(config, event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const period = resolvePosthogPeriod(query.period)
  const domainClause = buildPosthogCurrentUrlClause(project.domain)
  const cacheKey = `posthog:entry-exit:${project.projectId}:${project.domain}:${period.dateFrom}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch<PosthogEntryExitPayload>(
      cacheKey,
      async (): Promise<PosthogEntryExitPayload> => {
        const [entryResponse, exitResponse] = await Promise.all([
          posthogQueryFetch<PosthogQueryResults>(project, {
            kind: 'HogQLQuery',
            query: `
              SELECT
                replaceRegexpAll(properties.$pathname, '\\\\?.*', '') AS page,
                count() AS entries
              FROM events
              WHERE event = '$pageview'
                AND timestamp >= now() - ${period.intervalExpression}
                ${domainClause}
                AND properties.$is_initial_landing = true
              GROUP BY page
              ORDER BY entries DESC
              LIMIT 10
            `,
          }),
          posthogQueryFetch<PosthogQueryResults>(project, {
            kind: 'HogQLQuery',
            query: `
              SELECT
                replaceRegexpAll(properties.$pathname, '\\\\?.*', '') AS page,
                count() AS exits
              FROM events
              WHERE event = '$pageleave'
                AND timestamp >= now() - ${period.intervalExpression}
                ${domainClause}
              GROUP BY page
              ORDER BY exits DESC
              LIMIT 10
            `,
          }),
        ])

        return {
          entryPages: (entryResponse.results ?? []).map((row) => ({
            page: String(row[0] ?? '/'),
            count: Number(row[1] ?? 0),
          })),
          exitPages: (exitResponse.results ?? []).map((row) => ({
            page: String(row[0] ?? '/'),
            count: Number(row[1] ?? 0),
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
