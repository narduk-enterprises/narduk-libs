import { createError, defineEventHandler } from 'h3'

import { setCacheProfile } from './cacheProfile'
import { useLogger } from './logger'
import { defineRateLimitedHandler } from './rateLimitedHandler'

import type { CacheProfileInput } from './cacheProfile'
import type { RateLimitedHandlerOptions } from './rateLimitedHandler'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'

/** The 503 message a caller sees when the route does not supply its own. */
export const DEFAULT_PUBLISHED_DATA_FALLBACK_MESSAGE =
  'This data is temporarily unavailable. Please try again shortly.'

export interface PublishedDataHandlerOptions {
  /**
   * Operator-safe copy for the 503 a failed read returns. The real error is
   * logged server-side and never reaches the response body.
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
>(
  handler: EventHandler<Request, Response>,
  options: PublishedDataHandlerOptions,
): EventHandler<Request, Promise<Response>> {
  const { fallbackMessage, profile, rateLimit, tags, vary } = options

  const served = defineEventHandler<Request, Promise<Response>>(
    async (event): Promise<Response> => {
      let result: Response
      try {
        result = await handler(event)
      } catch (error) {
        if (carriesStatus(error)) throw error
        logFailure(event, error)
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
  // defineRateLimitedHandler awaits the wrapped handler, so the response type
  // is unchanged; its signature only nests the Promise one level deeper.
  return defineRateLimitedHandler(served, rateLimit) as unknown as EventHandler<
    Request,
    Promise<Response>
  >
}
