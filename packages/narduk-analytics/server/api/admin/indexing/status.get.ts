import { z } from 'zod'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

const querySchema = z.object({
  url: z.string().url(),
})

/**
 * Google Indexing API — get notification status for a URL.
 *
 * GET /api/admin/indexing/status?url=<encoded-url>
 *
 * Returns the last time Google received each kind of notification
 * (URL_UPDATED, URL_DELETED) for a given URL.
 *
 * Requires GSC_SERVICE_ACCOUNT_JSON with the Indexing API enabled.
 *
 * Usage:
 *   curl "https://your-site.com/api/admin/indexing/status?url=https%3A%2F%2Fyour-site.com%2Fjobs%2F42"
 */
export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Indexing')
  await requireAdmin(event)
  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.googleIndexingStatus)

  const query = await getValidatedQuery(event, querySchema.parse)
  const encodedUrl = encodeURIComponent(query.url)

  try {
    const data = await googleApiFetch(
      `https://indexing.googleapis.com/v3/urlNotifications/metadata?url=${encodedUrl}`,
      INDEXING_SCOPES,
      {},
      event,
    )

    log.debug('Indexing status checked', { url: query.url })

    return {
      url: query.url,
      metadata: data,
    }
  } catch (error: unknown) {
    const err = error as { message?: string; statusCode?: number; statusMessage?: string }
    log.error('Indexing status check failed', {
      url: query.url,
      error: err.statusMessage ?? err.message,
    })
    throw createError({
      statusCode: err.statusCode ?? 500,
      statusMessage: `Google Indexing API error: ${err.statusMessage ?? err.message}`,
    })
  }
})
