/**
 * Prepended Nitro error handler: a thrown error answered as **JSON** leaves
 * `private, no-store` (narduk-libs#493, the gap in #429).
 *
 * The `error-cache` plugin cannot reach this response. Nitro 2.13's error
 * chain is `[this module's sanitizer, this handler, Nuxt's handler, Nitro's
 * builtin]`. Nuxt's handler returns at once for a JSON request, so Nitro's
 * builtin answers. It sends the response itself, which marks the event
 * handled, so h3 never calls `onBeforeResponse` and the `beforeResponse` hook
 * `error-cache` relies on never fires. And the builtin writes
 * `cache-control: no-cache` on every 404, and on any error that has no
 * `Cache-Control` yet. Cloudflare Workers Cache stores a `no-cache` response
 * and revalidates it, so an app with `"cache": { "enabled": true }` stored its
 * API errors.
 *
 * Setting the header earlier would not survive: the builtin overwrites it on
 * a 404. So this handler answers the JSON error itself, with the body, status
 * and headers Nitro's own `defaultHandler` builds, and only the cache posture
 * changed. HTML errors are left to Nuxt, whose error page goes through
 * `render:response`, where `error-cache` already applies. A 302 (Nitro's
 * base-URL redirect for a 404) and `nuxt dev` are left to Nitro as well.
 */
import { getRequestHeader, send, setResponseHeaders, setResponseStatus } from 'h3'

import { applyNoStoreHeaders, applyNoStoreToEvent } from '../shared/utils/shared-cache'

import type { H3Event } from 'h3'

interface NitroDefaultErrorResponse {
  body: unknown
  headers: Record<string, string>
  status: number
  statusText?: string
}

type NitroDefaultHandler = (error: unknown, event: H3Event) => NitroDefaultErrorResponse

function hasRequestHeader(event: H3Event, name: string, includes: string): boolean {
  const value = getRequestHeader(event, name)
  return typeof value === 'string' && value.toLowerCase().includes(includes)
}

/**
 * The requests Nuxt's error handler hands back to Nitro as JSON. A copy of
 * `isJsonRequest` in `@nuxt/nitro-server`'s `runtime/utils/error`, which is
 * not exported; it has to agree with Nuxt, or a request would be answered by
 * neither handler's rules.
 */
export function isJsonErrorRequest(event: H3Event): boolean {
  if (hasRequestHeader(event, 'accept', 'text/html')) return false
  return (
    hasRequestHeader(event, 'accept', 'application/json') ||
    hasRequestHeader(event, 'user-agent', 'curl/') ||
    hasRequestHeader(event, 'user-agent', 'httpie/') ||
    hasRequestHeader(event, 'sec-fetch-mode', 'cors') ||
    event.path.startsWith('/api/') ||
    event.path.endsWith('.json')
  )
}

export async function answerJsonErrorNoStore(
  error: unknown,
  event: H3Event,
  defaultHandler: NitroDefaultHandler | undefined,
  isDev: boolean,
): Promise<void> {
  if (isDev || event.handled || !defaultHandler || !isJsonErrorRequest(event)) return
  const response = defaultHandler(error, event)
  if (response.status < 400) return

  setResponseHeaders(event, applyNoStoreHeaders(response.headers))
  // A route that called `setCacheProfile(event, 'live')` before throwing left
  // CDN headers on the event, which the header map above never contained.
  applyNoStoreToEvent(event)
  setResponseStatus(event, response.status, response.statusText)
  await send(event, JSON.stringify(response.body, null, 2))
}

export default async function nardukJsonErrorNoStore(
  error: unknown,
  event: H3Event,
  context?: { defaultHandler?: NitroDefaultHandler },
): Promise<void> {
  await answerJsonErrorNoStore(error, event, context?.defaultHandler, Boolean(import.meta.dev))
}
