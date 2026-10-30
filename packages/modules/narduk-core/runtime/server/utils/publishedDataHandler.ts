import { createError, defineEventHandler, setResponseStatus } from 'h3'

import { setCacheProfile } from './cacheProfile'
import { useLogger } from './logger'
import { defineRateLimitedHandler } from './rateLimitedHandler'

import type { CacheProfileInput } from './cacheProfile'
import type { RateLimitedHandlerOptions } from './rateLimitedHandler'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'

/** The 503 message a caller sees when the route does not supply its own. */
export const DEFAULT_PUBLISHED_DATA_FALLBACK_MESSAGE =
  'This data is temporarily unavailable. Please try again shortly.'

export interface PublishedDataHandlerOptions<Unavailable = never> {
  /**
   * Operator-safe copy for the 503 a failed read returns. The real error is
   * logged server-side and never reaches the response body. Ignored when
   * `unavailableBody` is passed.
   */
  fallbackMessage?: string
  /**
   * The cache posture a *successful* response advertises: a named profile
   * (`live`, `slow`, `static`, `none`) or an inline one. Applied only after
   * the handler resolves, never to an error.
   */
  profile: CacheProfileInput
  /**
   * Opt-in rate limit, applied through `defineRateLimitedHandler` in front of
   * the handler. Off unless passed: a published-data route is public, cached
   * read traffic, and most of it never reaches the Worker once the edge
   * stores it.
   *
   * A shared-cacheable route that does pass one should also pass
   * `headers: 'none'`: the `RateLimit-*` family is per caller, and although
   * `setCacheProfile` strips it from a shared-cacheable response
   * (narduk-libs#412), not emitting it is the simpler contract.
   */
  rateLimit?: RateLimitedHandlerOptions
  /** `Cache-Tag` values for purge-by-tag, passed to `setCacheProfile`. */
  tags?: readonly string[]
  /**
   * Builds the whole body of the 503 a failed read returns, for a route whose
   * contract publishes its own error envelope (`{ error: { code: 'DATA_UNAVAILABLE' } }`)
   * instead of the h3 error shape. The response is a 503 marked `private,
   * no-store`, with the returned value as its body and no other header
   * changes; the function may set its own, `Retry-After` for one. The real
   * error is still logged and is passed in only so the body can be chosen by
   * kind: never put its message in the body. A deliberate `statusCode` error
   * still passes through unchanged, and `fallbackMessage` is ignored. Off by
   * default, which keeps the h3 error.
   */
  unavailableBody?: (error: unknown, event: H3Event) => Unavailable
  /** Request headers the response varies on, passed to `setCacheProfile`. */
  vary?: readonly string[]
}

/** A deliberate HTTP error (`createError`, or anything carrying a status) passes through. */
function carriesStatus(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' && Number.isInteger(statusCode)
}

function logFailure(event: H3Event, error: unknown): void {
  try {
    useLogger(event).error('Published data read failed', { error })
  } catch {
    // A consumer fixture without a booted Nitro server has no request logger.
    // A missing log record must not turn the 503 into a 500.
  }
}

/**
 * Define a published-data route: a public read whose success is cacheable and
 * whose failure is not (narduk-libs#514).
 *
 * Replaces `defineEventHandler` at the route. Three things, in this order:
 *
 * 1. **Rate limit, only when `rateLimit` is passed.** `defineRateLimitedHandler`
 *    runs in front, so a denied caller never reaches the read. Off by default.
 * 2. **The handler.** A thrown error that already carries a `statusCode` (a
 *    deliberate `createError({ statusCode: 404 })`) is re-thrown unchanged.
 *    Anything else — a parse error, a failed fetch, a schema error whose
 *    message dumps every field — is logged server-side through the request
 *    logger and answered with a fixed 503 carrying `fallbackMessage`, so no
 *    internal detail reaches the public body.
 * 3. **The cache profile, after success only.** `setCacheProfile` runs once the
 *    handler has resolved. A route that set its profile first would advertise
 *    a 400 or 404 as publicly cacheable for the profile's TTL; here an error
 *    never gets a cacheable posture, and the core `error-cache` plugin makes it
 *    `private, no-store`. `setCacheProfile`'s own guards still apply to the
 *    success path (preview-safe mode, `Set-Cookie`, preferences, nonce-CSP
 *    HTML, a status the handler set to >= 400), as does its per-request header
 *    strip on a shared-cacheable profile (narduk-libs#412, #418).
 *
 * @example
 * ```ts
 * // server/api/stations/index.get.ts
 * export default definePublishedDataHandler(
 *   async (event) => listStations(getQuery(event)),
 *   {
 *     profile: 'live',
 *     tags: ['published-data'],
 *     fallbackMessage: 'Station data is temporarily unavailable.',
 *   },
 * )
 * ```
 */
export function definePublishedDataHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response = unknown,
  Unavailable = never,
>(
  handler: EventHandler<Request, Response>,
  options: PublishedDataHandlerOptions<Unavailable>,
): EventHandler<Request, Promise<Response | Unavailable>> {
  const { fallbackMessage, profile, rateLimit, tags, unavailableBody, vary } = options

  const served = defineEventHandler<Request, Promise<Response | Unavailable>>(
    async (event): Promise<Response | Unavailable> => {
      let result: Response
      try {
        result = await handler(event)
      } catch (error) {
        if (carriesStatus(error)) throw error
        logFailure(event, error)
        if (unavailableBody) {
          const body = unavailableBody(error, event)
          setResponseStatus(event, 503, 'Service Unavailable')
          // Status first: setCacheProfile downgrades an error status to none.
          setCacheProfile(event, 'none')
          return body
        }
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable',
          message: fallbackMessage ?? DEFAULT_PUBLISHED_DATA_FALLBACK_MESSAGE,
        })
      }
      setCacheProfile(event, profile, { tags, vary })
      return result
    },
  )

  if (!rateLimit) return served
  return defineRateLimitedHandler(served, rateLimit)
}
