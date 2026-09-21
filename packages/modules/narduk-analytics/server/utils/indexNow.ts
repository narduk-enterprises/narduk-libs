import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'
import {
  hasRuntimeEnvBinding,
  readRuntimeString,
  trimRuntimeString,
} from '@narduk-enterprises/narduk-core/server/utils/runtime-env'

import { analyticsRuntimeConfig, type AnalyticsServerRuntimeConfig } from './runtimeConfig'

/**
 * IndexNow Programmatic Ping Utility.
 *
 * Proactively notifies search engines (Bing, Yandex, etc.) when URLs
 * are created or updated. Call this after CMS changes, content approvals,
 * or any page-level mutation that warrants immediate indexing.
 *
 * Separate from the IndexNow middleware (which handles key verification
 * and automatic submission on page load). This is for explicit, batched
 * submissions from server routes.
 *
 * @see https://www.indexnow.org/documentation
 *
 * @example
 * ```ts
 * // After approving a new blog post:
 * await notifyIndexNow(event, [
 *   'https://example.com/blog/new-post',
 *   'https://example.com/blog',
 * ])
 * ```
 */
import type { H3Event } from 'h3'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const MAX_URLS_PER_BATCH = 10_000

/**
 * Resolve the IndexNow key from Worker runtime bindings first, then from
 * private/public runtimeConfig fallbacks. Blank runtime bindings still allow
 * alias and config fallback so an empty primary alias does not disable
 * verification or submission when another configured key exists.
 */
export function resolveIndexNowKeyFromRuntimeConfig(
  config: AnalyticsServerRuntimeConfig,
  event?: H3Event,
): string {
  const fallback =
    [
      trimRuntimeString((config as Record<string, unknown>).indexNowKey),
      trimRuntimeString((config.public as Record<string, unknown>).indexNowKey),
    ].find((key) => key.length > 0) ?? ''

  if (
    event &&
    (hasRuntimeEnvBinding(event, 'INDEXNOW_KEY') ||
      hasRuntimeEnvBinding(event, 'NUXT_PUBLIC_INDEXNOW_KEY'))
  ) {
    return (
      readRuntimeString(event, 'INDEXNOW_KEY') ||
      readRuntimeString(event, 'NUXT_PUBLIC_INDEXNOW_KEY') ||
      fallback
    )
  }

  return fallback
}

export interface IndexNowResult {
  error?: string
  submitted: number
  success: boolean
}

/**
 * Submit URLs to IndexNow for immediate search engine indexing.
 *
 * Reads the IndexNow key from Worker runtime bindings first, then
 * runtimeConfig fallbacks, and derives the host from the site URL.
 * Returns silently if no key is configured (common in dev).
 *
 * @param event   - H3 event (for runtime config access)
 * @param urls    - Full URLs to submit (up to 10,000 per batch)
 * @param siteHost - Override the auto-detected host (optional)
 */
export async function notifyIndexNow(
  event: H3Event,
  urls: string[],
  siteHost?: string,
): Promise<IndexNowResult> {
  const config = analyticsRuntimeConfig(event)
  const key = resolveIndexNowKeyFromRuntimeConfig(config, event)

  if (!key) {
    return { success: false, submitted: 0, error: 'INDEXNOW_KEY not configured' }
  }

  if (urls.length === 0) {
    return { success: true, submitted: 0 }
  }

  // Derive host from site URL if not provided
  const host =
    siteHost ??
    (() => {
      try {
        const siteUrl = readRuntimeString(event, 'SITE_URL', {
          config,
          fallback: (config.public as Record<string, unknown>).appUrl,
        })
        return new URL(siteUrl).host
      } catch {
        return ''
      }
    })()

  if (!host) {
    return { success: false, submitted: 0, error: 'Could not determine site host' }
  }

  const log = useLogger(event).child('IndexNow')
  const batch = urls.slice(0, MAX_URLS_PER_BATCH)

  try {
    await $fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: {
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList: batch,
      },
    })

    log.debug(`Submitted ${batch.length} URLs`)
    return { success: true, submitted: batch.length }
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number }
    log.warn(`Ping failed: ${err.message ?? 'Unknown error'}`)
    return {
      success: false,
      submitted: 0,
      error: err.message ?? 'IndexNow request failed',
    }
  }
}
