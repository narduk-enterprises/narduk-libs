import { requireAdmin } from '@narduk-enterprises/narduk-core/server/utils/auth'
import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { z } from 'zod'

import { resolveGscSiteUrl } from '#narduk-analytics-server/utils/siteConfig'

const DIMENSIONS = ['query', 'page', 'device', 'country', 'searchAppearance'] as const

const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dimension: z.enum(DIMENSIONS).optional().default('query'),
  noCache: z.coerce.boolean().optional(),
})

interface GscRow {
  clicks: number
  ctr: number
  impressions: number
  keys: string[]
  position: number
}

interface GscQueryResponse {
  rows?: GscRow[]
}

export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Analytics')
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const gscSiteUrl = resolveGscSiteUrl(config, event)
  if (!gscSiteUrl) {
    throw createError({ statusCode: 500, statusMessage: 'GSC_SITE_URL or SITE_URL not configured' })
  }

  const query = await getValidatedQuery(event, querySchema.parse)
  const { startDate, endDate } = resolveAnalyticsDateRange(query)

  const cacheKey = `gsc:perf:${gscSiteUrl}:${query.dimension}:${startDate}:${endDate}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch(
      cacheKey,
      async () => {
        const raw = (await googleApiFetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gscSiteUrl)}/searchAnalytics/query`,
          GSC_SCOPES,
          {
            method: 'POST',
            body: JSON.stringify({
              startDate,
              endDate,
              dimensions: [query.dimension],
              rowLimit: 50,
            }),
          },
          event,
        )) as GscQueryResponse

        return { rows: raw.rows ?? [] }
      },
      query.noCache ? 0 : undefined,
    )

    log.debug('GSC performance fetched', { dimension: query.dimension, startDate, endDate, cached })

    return {
      ...data,
      startDate,
      endDate,
      dimension: query.dimension,
      cached,
      fetchedAt,
    }
  } catch (error: unknown) {
    if (error instanceof GoogleApiError) {
      log.error('GSC performance failed', { status: error.status, error: error.message })
      throw createError({
        statusCode: error.status,
        statusMessage: `GSC performance error: ${error.message}`,
      })
    }
    const err = error as { message?: string; statusCode?: number; statusMessage?: string }
    log.error('GSC performance failed', { error: err.statusMessage ?? err.message })
    throw createError({
      statusCode: err.statusCode ?? 500,
      statusMessage: `GSC performance error: ${err.statusMessage ?? err.message}`,
    })
  }
})
