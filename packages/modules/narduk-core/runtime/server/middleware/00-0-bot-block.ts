import { defineEventHandler, getRequestHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { createBotMatcher } from '../../shared/bot-block'

/**
 * Refuses SEO, backlink and scraper crawlers (`DEFAULT_BLOCKED_BOTS`) with a
 * 403 before anything else runs, so a request that will never convert does not
 * pay for a render, a D1 binding or a request-log row. It does no I/O.
 *
 * It sorts ahead of `00-canonical-host` on purpose: a blocked crawler should
 * not be redirected to the canonical host and then refused there.
 *
 * `/robots.txt` and `/api/health` are never refused, so a compliant crawler can
 * read the disallow and a monitor with an odd User-Agent still sees the Worker.
 *
 * Configured by `nardukCore.botBlock` ({ enabled, extra, allow }), carried in
 * `runtimeConfig.nardukBotBlock`. `NUXT_NARDUK_BOT_BLOCK_ENABLED=false` turns it
 * off at deploy time.
 */

const EXEMPT_PATHS = new Set(['/robots.txt', '/api/health'])

let cached: { matcher: (userAgent: string | undefined) => boolean; source: unknown } | undefined

/**
 * The matcher is built once per isolate. `useRuntimeConfig()` without an event
 * returns Nitro's shared config object, so the identity check is a pointer
 * compare; calling it with an event clones the config per request.
 */
function botMatcher() {
  const source = (useRuntimeConfig() as Record<string, unknown>).nardukBotBlock
  if (cached && cached.source === source) return cached.matcher
  let matcher: (userAgent: string | undefined) => boolean
  try {
    matcher = createBotMatcher(source)
  } catch {
    matcher = createBotMatcher(undefined)
  }
  cached = { matcher, source }
  return matcher
}

export default defineEventHandler((event) => {
  const userAgent = getRequestHeader(event, 'user-agent')
  if (!userAgent) return

  const pathname = event.path.split('?')[0] ?? event.path
  if (EXEMPT_PATHS.has(pathname)) return

  if (!botMatcher()(userAgent)) return

  setResponseStatus(event, 403)
  setResponseHeaders(event, {
    'Cache-Control': 'public, max-age=86400',
    'Content-Type': 'text/plain; charset=utf-8',
    Vary: 'User-Agent',
  })
  return 'Forbidden: automated SEO crawlers are not served. See /robots.txt.\n'
})
