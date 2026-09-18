import { getResponseStatus } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'

import {
  isWebResponseLike,
  stripPerRequestHeadersFromEvent,
  stripPerRequestHeadersFromWebResponse,
  stripPerRequestHeadersIfShared,
} from '../../shared/utils/shared-cache'

import type { H3Event } from 'h3'

/**
 * Per-request headers never leave on a shared-cacheable response
 * (narduk-libs#412, #418).
 *
 * `setCacheProfile` already strips the `RateLimit-*` family, `Retry-After`,
 * `x-request-id` and `Server-Timing` when it emits a public profile — the
 * natural order, since `defineRateLimitedHandler` and the request logger write
 * before the handler picks its profile. This plugin is the backstop for the
 * other order: a header written *after* the profile (a route that sets its
 * profile in middleware, a limiter wrapped inside another wrapper, a returned
 * web `Response` carrying its own headers). With both halves in place the order
 * of operations does not matter.
 *
 * Errors (status >= 400) are left alone: the `error-cache` plugin makes them
 * `no-store`, and on a 429 `Retry-After` and the quota family are the point.
 *
 * `beforeResponse` runs before h3 copies a returned `Response`'s own headers
 * onto the event, so that body is sanitised here while it is still mutable —
 * the same reason `error-cache.ts` gives.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('beforeResponse', (event: H3Event, response) => {
    const body = (response as { body?: unknown } | undefined)?.body
    if (isWebResponseLike(body)) {
      const sanitized = stripPerRequestHeadersFromWebResponse(body)
      if (!sanitized) return
      if (response) (response as { body?: unknown }).body = sanitized
      // h3 merges the returned Response's headers over the event's, so what the
      // logger or limiter already wrote on the event would still ship. The
      // returned Response decides the posture; judge the event by it.
      stripPerRequestHeadersFromEvent(event)
      return
    }
    stripPerRequestHeadersIfShared(event, getResponseStatus(event))
  })
})
