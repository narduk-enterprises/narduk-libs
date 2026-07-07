import { z } from 'zod'

import {
  defineAdminMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { resolveGscSiteUrl } from '#narduk-analytics-server/utils/siteConfig'

const bodySchema = z.object({
  url: z.string().url(),
})

export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminUsers,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const config = useRuntimeConfig(event)
    const siteUrl = resolveGscSiteUrl(config, event)

    if (!siteUrl) {
      throw createError({
        statusCode: 500,
        statusMessage: 'GSC_SITE_URL or SITE_URL not configured',
      })
    }

    try {
      const data = await googleApiFetch(
        'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
        GSC_SCOPES,
        {
          method: 'POST',
          body: JSON.stringify({
            inspectionUrl: input.url,
            siteUrl,
          }),
        },
        event,
      )

      const result = (data as Record<string, Record<string, unknown>>).inspectionResult ?? {}
      const indexStatus = (result.indexStatusResult ?? {}) as Record<string, unknown>

      return {
        url: input.url,
        siteUrl,
        verdict: indexStatus.verdict ?? 'UNKNOWN',
        coverageState: indexStatus.coverageState ?? 'N/A',
        lastCrawlTime: indexStatus.lastCrawlTime ?? null,
        pageFetchState: indexStatus.pageFetchState ?? 'N/A',
        robotsTxtState: indexStatus.robotsTxtState ?? 'N/A',
        indexingState: indexStatus.indexingState ?? 'N/A',
        crawledAs: indexStatus.crawledAs ?? 'N/A',
        referringUrls: indexStatus.referringUrls ?? [],
      }
    } catch (error: unknown) {
      const err = error as { message?: string; statusCode?: number; statusMessage?: string }

      if (err.statusCode === 403) {
        throw createError({
          statusCode: 403,
          statusMessage:
            'URL Inspection API access denied. Ensure the service account has GSC property access and the Search Console API is enabled.',
        })
      }

      throw createError({
        statusCode: err.statusCode ?? 500,
        statusMessage: `URL Inspection error: ${err.statusMessage ?? err.message}`,
      })
    }
  },
)
