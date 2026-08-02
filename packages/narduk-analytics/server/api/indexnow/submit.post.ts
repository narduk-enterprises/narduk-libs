import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import { readRuntimeString } from '@narduk-enterprises/narduk-core/server/utils/runtime-env'
import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withOptionalValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { resolveIndexNowKeyFromRuntimeConfig } from '#narduk-analytics-server/utils/indexNow'

const bodySchema = z.object({
  urls: z.array(z.string().url()).optional().default([]),
})

/**
 * IndexNow URL submission API route.
 *
 * POST /api/indexnow/submit
 * Body: { urls: string[] }   (optional — defaults to sitemap URLs)
 *
 * Submits URLs to IndexNow-compatible search engines (Bing, Yandex, Seznam, Naver).
 * Requires INDEXNOW_KEY to be set.
 *
 * Usage after deploy:
 *   curl -X POST https://your-site.com/api/indexnow/submit \
 *     -H "Content-Type: application/json" \
 *     -d '{"urls": ["https://your-site.com/", "https://your-site.com/about"]}'
 */
export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.indexNowSubmit,
    parseBody: withOptionalValidatedBody(bodySchema.parse, {}),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const log = useLogger(event).child('IndexNow')
    const config = useRuntimeConfig(event)
    const key = resolveIndexNowKeyFromRuntimeConfig(config, event)
    const siteUrl = readRuntimeString(event, 'SITE_URL', {
      config,
      fallback: config.public.appUrl,
    })

    if (!key) {
      throw createError({ statusCode: 400, message: 'INDEXNOW_KEY not configured' })
    }
    if (!siteUrl) {
      throw createError({ statusCode: 400, message: 'SITE_URL not configured' })
    }

    let urls = input.urls

    // Default: submit the homepage + sitemap URL if no URLs provided
    if (!urls.length) {
      const base = siteUrl.replace(/\/$/, '')
      urls = [base + '/', base + '/sitemap.xml']
    }

    const host = new URL(siteUrl).host
    const keyLocation = `${siteUrl.replace(/\/$/, '')}/${key}.txt`

    // IndexNow batch API — submit to Bing (which shares with all IndexNow engines)
    const indexNowPayload = {
      host,
      key,
      keyLocation,
      urlList: urls,
    }

    const results: Array<{ engine: string; ok: boolean; status: number }> = []

    // Bing is the primary IndexNow endpoint; it shares with Yandex, Seznam, Naver
    const engines = ['https://api.indexnow.org/indexnow']

    for (const engine of engines) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Sequential pings are expected for IndexNow endpoints
        const response = await fetch(engine, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(indexNowPayload),
        })
        results.push({
          engine,
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
        })
      } catch (_error: unknown) {
        const message = _error instanceof Error ? _error.message : String(_error)
        log.warn(`Failed to ping ${engine}`, { error: message })
        results.push({
          engine,
          status: 0,
          ok: false,
        })
      }
    }

    log.info('IndexNow submitted', { count: urls.length, results })

    return {
      submitted: urls.length,
      urls,
      results,
    }
  },
)
