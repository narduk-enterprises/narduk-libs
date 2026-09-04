import {
  hasRuntimeEnvBinding,
  readRuntimeString,
  trimRuntimeString,
} from '@narduk-enterprises/narduk-core/server/utils/runtime-env'
import { createError, setResponseHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import type { H3Event } from 'h3'

/**
 * Accepted IndexNow key shape. Mirrors the drift/audit checker in
 * `command` (`seo-governance.ts`) which validates the same pattern.
 */
const INDEXNOW_KEY_PATTERN = /^[a-z0-9-]{8,128}$/i

/**
 * Resolve the configured IndexNow key using the same priority order as
 * `notifyIndexNow()` and the submit endpoint:
 *
 *   1. Worker runtime env `INDEXNOW_KEY` (Cloudflare secret / var)
 *   2. Worker runtime env `NUXT_PUBLIC_INDEXNOW_KEY`
 *   3. private `runtimeConfig.indexNowKey` (set via `NUXT_INDEXNOW_KEY`)
 *   4. `runtimeConfig.public.indexNowKey`
 *
 * Workers Builds frequently omit Doppler/Cloudflare secrets from the Nuxt
 * build bundle, which leaves `runtimeConfig.public.indexNowKey` empty at
 * build time even when the key exists as a runtime secret. Runtime-first reads
 * keep verification working without rebuilding or leaking the secret into the
 * client.
 */
function resolveConfiguredKey(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const fallback =
    [
      trimRuntimeString((config as Record<string, unknown>).indexNowKey),
      trimRuntimeString((config.public as Record<string, unknown>).indexNowKey),
    ].find((key) => key.length > 0) ?? ''

  if (
    hasRuntimeEnvBinding(event, 'INDEXNOW_KEY') ||
    hasRuntimeEnvBinding(event, 'NUXT_PUBLIC_INDEXNOW_KEY')
  ) {
    return (
      readRuntimeString(event, 'INDEXNOW_KEY') ||
      readRuntimeString(event, 'NUXT_PUBLIC_INDEXNOW_KEY') ||
      fallback
    )
  }

  return fallback
}

/**
 * IndexNow key verification (`GET|HEAD /<key>.txt` at site root).
 *
 * Implemented in middleware (rather than a `server/routes/[key].txt.get.ts`
 * dynamic route) because Nitro's `/:key.txt` pattern incorrectly matches
 * single-segment HTML paths such as `/` and `/about`, shadowing the Vue
 * renderer for GET requests. See apps-catalog#16 for the original bug.
 *
 * Behavior (intentionally fall-through-friendly for a shared layer):
 * - Non-GET/HEAD → not handled.
 * - Paths that are not `/<segment>.txt` → not handled.
 * - `<segment>` that fails percent-decoding → 400 Bad request.
 * - No configured key or key fails the accepted shape → not handled
 *   (request falls through to the normal Nuxt page renderer, so apps
 *   can still serve `/robots.txt`, `/ads.txt`, etc.).
 * - Valid configured key + requested segment does not match → not
 *   handled (same fall-through rationale).
 * - Exact match → 200 text/plain with the key as body (HEAD returns '').
 *
 * @returns key body for matching GET, '' for matching HEAD, or undefined
 *   to indicate the middleware did not handle the request.
 */
export function handleIndexNowKeyVerification(event: H3Event): string | undefined {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    return undefined
  }

  const m = /^\/([^/]+)\.txt$/.exec(event.path)
  if (!m) {
    return undefined
  }

  let requestedKey = m[1] ?? ''
  try {
    requestedKey = decodeURIComponent(requestedKey)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }

  const configuredKey = resolveConfiguredKey(event)

  if (!configuredKey || !INDEXNOW_KEY_PATTERN.test(configuredKey)) {
    return undefined
  }

  if (requestedKey !== configuredKey) {
    return undefined
  }

  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  if (event.method === 'HEAD') {
    return ''
  }

  return configuredKey
}
