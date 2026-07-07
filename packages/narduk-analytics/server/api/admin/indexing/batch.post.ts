import { z } from 'zod'

import {
  defineAdminMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { assertAnalyticsWriteAllowed } from '#narduk-analytics-server/utils/siteConfig'

const bodySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(100),
  type: z.enum(['URL_UPDATED', 'URL_DELETED']).optional().default('URL_UPDATED'),
})

/**
 * Google Indexing API — batch publish URL notifications.
 *
 * POST /api/admin/indexing/batch
 * Body: { urls: string[], type?: "URL_UPDATED" | "URL_DELETED" }
 *
 * Submits up to 100 URLs in a single batch request using Google's
 * multipart/mixed batch API.
 *
 * Requires GSC_SERVICE_ACCOUNT_JSON with the Indexing API enabled.
 */
export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.googleIndexingBatch,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    assertAnalyticsWriteAllowed(useRuntimeConfig(event), event)
    const log = useLogger(event).child('Indexing')
    const { urls, type } = input
    const boundary = `===============${Date.now()}==`
    const batchBody = buildBatchBody(urls, type, boundary)
    const token = await getAccessToken(INDEXING_SCOPES, event)

    try {
      const response = await fetch('https://indexing.googleapis.com/batch', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/mixed; boundary="${boundary}"`,
          Authorization: `Bearer ${token}`,
        },
        body: batchBody,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw createError({
          statusCode: response.status,
          statusMessage: `Google Indexing API batch error: ${errorText}`,
        })
      }

      const responseText = await response.text()
      const responseBoundary =
        response.headers.get('content-type')?.match(/boundary=(.+)/)?.[1] ?? boundary
      const results = parseBatchResponse(responseText, responseBoundary)

      log.info('Batch indexing submitted', { count: urls.length, type })

      return {
        success: true,
        submitted: urls.length,
        type,
        results,
      }
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode) throw error
      const err = error as { message?: string }
      log.error('Batch indexing failed', { count: urls.length, type, error: err.message })
      throw createError({
        statusCode: 500,
        statusMessage: `Google Indexing API batch error: ${err.message}`,
      })
    }
  },
)
