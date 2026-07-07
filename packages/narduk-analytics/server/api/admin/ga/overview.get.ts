import { readRuntimeString } from '@narduk-enterprises/narduk-core/server/utils/runtime-env'
import { z } from 'zod'

const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  noCache: z.coerce.boolean().optional(),
})

interface GaMetricValue {
  value: string
}

interface GaTotalsRow {
  metricValues?: GaMetricValue[]
}

interface GaDimensionValue {
  value: string
}

interface GaRow {
  dimensionValues?: GaDimensionValue[]
  metricValues?: GaMetricValue[]
}

interface GaReportResponse {
  rows?: GaRow[]
  totals?: GaTotalsRow[]
}

export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Analytics')
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const propertyId = readRuntimeString(event, 'GA_PROPERTY_ID', {
    config,
    fallback: config.gaPropertyId,
  })

  if (!propertyId) {
    throw createError({ statusCode: 500, statusMessage: 'GA_PROPERTY_ID not configured' })
  }

  const query = await getValidatedQuery(event, querySchema.parse)
  const { startDate, endDate } = resolveAnalyticsDateRange(query)

  const cacheKey = `ga:overview:${propertyId}:${startDate}:${endDate}`

  try {
    const { data, cached, fetchedAt } = await cachedAnalyticsFetch(
      cacheKey,
      async () => {
        const raw = (await googleApiFetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          GA_SCOPES,
          {
            method: 'POST',
            body: JSON.stringify({
              dateRanges: [{ startDate, endDate }],
              metrics: [
                { name: 'activeUsers' },
                { name: 'sessions' },
                { name: 'screenPageViews' },
                { name: 'bounceRate' },
                { name: 'averageSessionDuration' },
              ],
              dimensions: [{ name: 'date' }],
            }),
          },
          event,
        )) as GaReportResponse

        return {
          totals: raw.totals?.[0]?.metricValues ?? [],
          rows: raw.rows ?? [],
        }
      },
      query.noCache ? 0 : undefined,
    )

    log.debug('GA overview fetched', { startDate, endDate, cached })

    return {
      ...data,
      startDate,
      endDate,
      cached,
      fetchedAt,
    }
  } catch (error: unknown) {
    if (error instanceof GoogleApiError) {
      log.error('GA overview failed', { status: error.status, error: error.message })
      throw createError({
        statusCode: error.status,
        statusMessage: `GA4 Error: ${error.message}`,
      })
    }
    const err = error as { message?: string; statusCode?: number; statusMessage?: string }
    log.error('GA overview failed', { error: err.statusMessage ?? err.message })
    throw createError({
      statusCode: err.statusCode ?? 500,
      statusMessage: `GA4 Error: ${err.statusMessage ?? err.message}`,
    })
  }
})
