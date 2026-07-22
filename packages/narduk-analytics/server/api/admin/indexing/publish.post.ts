import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { z } from 'zod'

import {
  defineAdminMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { assertAnalyticsWriteAllowed } from '#narduk-analytics-server/utils/siteConfig'

const bodySchema = z.object({
  url: z.string().url(),
  type: z.enum(['URL_UPDATED', 'URL_DELETED']).optional().default('URL_UPDATED'),
})

/**
 * Google Indexing API — publish a single URL notification.
 *
 * POST /api/admin/indexing/publish
 * Body: { url: string, type?: "URL_UPDATED" | "URL_DELETED" }
 *
 * Notifies Google that a URL has been updated or should be removed.
 * Requires GSC_SERVICE_ACCOUNT_JSON with the Indexing API enabled.
 *
 * Note: Google officially limits the Indexing API to pages with JobPosting
 * or BroadcastEvent structured data, but may process other page types.
 *
 * Usage:
 *   curl -X POST https://your-site.com/api/admin/indexing/publish \
 *     -H "Content-Type: application/json" \
 *     -d '{"url": "https://your-site.com/jobs/42", "type": "URL_UPDATED"}'
 */
export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.googleIndexingPublish,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    assertAnalyticsWriteAllowed(useRuntimeConfig(event), event)
    const log = useLogger(event).child('Indexing')
    const { url, type } = input

    try {
      const data = await googleApiFetch(
        'https://indexing.googleapis.com/v3/urlNotifications:publish',
        INDEXING_SCOPES,
        {
          method: 'POST',
          body: JSON.stringify({ url, type }),
        },
        event,
      )

      log.info('URL published to indexing', { url, type })

      return {
        success: true,
        url,
        type,
        metadata: data,
      }
    } catch (error: unknown) {
      const err = error as { message?: string; statusCode?: number; statusMessage?: string }
      log.error('URL publish failed', { url, error: err.statusMessage ?? err.message })
      throw createError({
        statusCode: err.statusCode ?? 500,
        statusMessage: `Google Indexing API error: ${err.statusMessage ?? err.message}`,
      })
    }
  },
)
