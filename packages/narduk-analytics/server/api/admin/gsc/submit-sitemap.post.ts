import { z } from 'zod'

import {
  defineAdminMutation,
  requireMutationBody,
  withOptionalValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  assertAnalyticsWriteAllowed,
  resolveAnalyticsAppUrl,
  resolveGscSiteUrl,
} from '#narduk-analytics-server/utils/siteConfig'

const bodySchema = z.object({
  sitemapUrl: z.string().url().optional(),
})

export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminUsers,
    parseBody: withOptionalValidatedBody(bodySchema.parse, {}),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const config = useRuntimeConfig(event)
    assertAnalyticsWriteAllowed(config, event)
    const siteUrl = resolveGscSiteUrl(config, event)

    if (!siteUrl) {
      throw createError({
        statusCode: 500,
        statusMessage: 'GSC_SITE_URL or SITE_URL not configured',
      })
    }

    const fallbackSiteUrl = resolveAnalyticsAppUrl(config, event)
    if (!input.sitemapUrl && !fallbackSiteUrl) {
      throw createError({
        statusCode: 500,
        statusMessage: 'SITE_URL must be configured when sitemapUrl is omitted',
      })
    }
    const sitemapUrl = input.sitemapUrl ?? `${fallbackSiteUrl.replace(/\/$/, '')}/sitemap.xml`

    await googleApiFetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      GSC_WRITE_SCOPES,
      { method: 'PUT' },
      event,
    )

    return {
      success: true,
      siteUrl,
      submitted: sitemapUrl,
    }
  },
)
