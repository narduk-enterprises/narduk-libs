import { createError, defineEventHandler, setResponseHeader } from 'h3'

import { applyNoStoreToEvent } from '../../shared/utils/shared-cache'
import { buildRateLimitHeaders } from '../rate-limit/headers'
import {
  isRateLimitExemptPath,
  rateLimitCounterKey,
  resolveBindingName,
  resolveExemptPaths,
  resolveRoutePolicy,
} from '../rate-limit/policy'
import { sharedRateLimitWindowStore } from '../rate-limit/window'

import { getClientIp } from './client-ip'
import { ensureRequestId, useLogger } from './logger'
import { readCloudflareRuntimeEnv } from './worker-env'

import type { CloudflareRateLimitBinding } from '../rate-limit/binding'
import type {
  RateLimitRouteOptions,
  RateLimitRuntimeConfig,
  ResolvedRateLimitPolicy,
} from '../rate-limit/policy'
import type { RateLimitVerdict, RateLimitWindowStore } from '../rate-limit/window'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'

export type {
  RateLimitHeaderMode,
  RateLimitRouteOptions,
  RateLimitRuntimeConfig,
  RateLimitScope,
} from '../rate-limit/policy'
export { RATE_LIMIT_DEFAULT_EXEMPT_PATHS, RATE_LIMIT_DEFAULTS } from '../rate-limit/policy'

type NitroRuntimeConfigAccessor = (event?: H3Event) => Record<string, unknown>

/**
 * `nitropack/runtime` is a barrel that statically re-exports build-time-only
 * virtual specifiers, so a *static* import of it makes this module unloadable
 * in a plain unit test or anywhere Nitro was never booted. Resolve it lazily
 * and cache the outcome, exactly as `utils/logger.ts` does and for the same
 * reason; "runtime config unavailable" is an expected, handled state below.
 */
let cachedUseRuntimeConfig: NitroRuntimeConfigAccessor | null | undefined

void import('nitropack/runtime')
  .then(
    (nitroRuntime) =>
      (cachedUseRuntimeConfig = nitroRuntime.useRuntimeConfig as NitroRuntimeConfigAccessor),
  )
  .catch(() => {
    cachedUseRuntimeConfig = null
  })

function readRateLimitConfig(event: H3Event): RateLimitRuntimeConfig | undefined {
  if (!cachedUseRuntimeConfig) return undefined
  try {
    const config = cachedUseRuntimeConfig(event)
    const block = (config as { nardukRateLimit?: unknown }).nardukRateLimit
    return block && typeof block === 'object' ? (block as RateLimitRuntimeConfig) : undefined
  } catch {
    // No booted Nitro server (prerender, isolated consumer fixture, unit test).
    // Every value then comes from the call site and the package defaults.
    return undefined
  }
}

/**
 * The Cloudflare Rate Limiting binding for this policy, when the app declared
 * one. Read per request from `event.context.cloudflare.env`, never from a
 * top-level `cloudflare:workers` import, because Nitro's prerenderer runs
 * compiled modules under Node's ESM loader and rejects that URL scheme.
 *
 * Absent everywhere except a real Workers request: the binding is a `workerd`
 * primitive with no Node equivalent, and Cloudflare documents no local-dev
 * simulation for it. The in-isolate window therefore always runs too.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
function readBinding(
  event: H3Event,
  policy: ResolvedRateLimitPolicy,
): CloudflareRateLimitBinding | undefined {
  const bindingName = resolveBindingName(policy)
  if (!bindingName) return undefined

  const candidate = readCloudflareRuntimeEnv(event)[bindingName]
  if (!candidate || typeof candidate !== 'object') return undefined

  const limit = (candidate as { limit?: unknown }).limit
  return typeof limit === 'function' ? (candidate as CloudflareRateLimitBinding) : undefined
}

/** Log the denial once, and never let logging itself fail the request. */
function logDenial(
  event: H3Event,
  policy: ResolvedRateLimitPolicy,
  verdict: RateLimitVerdict,
  enforcedBy: 'binding' | 'window',
) {
  try {
    const matched = event.context.matchedRoute as { path?: unknown } | undefined
    useLogger(event).warn('Rate limit exceeded', {
      enforcedBy,
      limit: policy.limit,
      rateLimitKey: policy.key,
      // The matched route template, not `event.path`: the raw path carries
      // caller-chosen identifiers and query values that do not belong in logs.
      route: typeof matched?.path === 'string' ? matched.path : '/[unmatched]',
      retryAfterSeconds: verdict.retryAfterSeconds,
      scope: policy.scope,
      windowSeconds: policy.windowSeconds,
    })
  } catch {
    // narduk-logging is a dependency of this package, but a consumer fixture
    // without a booted Nitro server has no request-local logger to reach. A
    // missing log record must not turn a 429 into a 500.
  }
}

/** Options accepted by {@link defineRateLimitedHandler}, plus test seams. */
export interface RateLimitedHandlerOptions extends RateLimitRouteOptions {
  /** Injected clock, for deterministic tests. Defaults to `Date.now`. */
  now?: () => number
  /**
   * Counter store. Defaults to the process-wide store every route shares;
   * tests pass their own so they never inherit another test's counts.
   */
  store?: RateLimitWindowStore
}

/**
 * Wrap a Nitro route handler in a per-route rate limit.
 *
 * Replaces `defineEventHandler` at the route and adds one options object — the
 * app declares what the route's allowance is and nothing else. There is no
 * app-side limiter to write and no library registry to edit.
 *
 * ## What enforces the limit
 *
 * Both layers, in this order, and a denial from either answers 429:
 *
 * 1. **The Cloudflare Rate Limiting binding**, when the app declared a
 *    matching `ratelimits` entry. Coordinated per Cloudflare location, so it is
 *    the more accurate enforcer and it runs first. Its `.limit()` resolves to
 *    `{ success }` alone, so it can say *no* but cannot say *how much is left*.
 * 2. **The in-isolate window**, always. It is per isolate, so on its own it
 *    permits roughly `limit x live isolates`; it is kept regardless because it
 *    is the only source of the `RateLimit-*` quota headers, the only path that
 *    supports a window other than 10 or 60 seconds, and the only one that
 *    exists in `nuxt dev`, in vitest and under plain Node.
 *
 * The binding is an upgrade, never a prerequisite: Cloudflare does not document
 * whether it is available on the Workers Free plan, so an app on Free adopts
 * this helper with no wrangler change at all and can add the binding later
 * without touching a line of route code.
 *
 * ## Exemptions
 *
 * `/api/health`, `robots.txt` and the sitemap surfaces are never limited — a
 * 429 on a health probe reads as an outage and a throttled crawler is an SEO
 * self-injury. Override with `runtimeConfig.nardukRateLimit.exemptPaths`.
 *
 * ## On a denial
 *
 * 429 with `Retry-After`, the configured `RateLimit-*` family, the request's
 * `x-request-id` preserved so the client's report correlates to the server
 * record, and exactly one structured warning through narduk-logging.
 *
 * @example
 * ```ts
 * // server/api/stations/index.get.ts
 * export default defineRateLimitedHandler(
 *   async (event) => listStations(getQuery(event)),
 *   { key: 'marine-public-api', limit: 120, windowSeconds: 60 },
 * )
 * ```
 */
export function defineRateLimitedHandler<
  Request extends EventHandlerRequest = EventHandlerRequest,
  Response = unknown,
>(
  handler: EventHandler<Request, Response>,
  options: RateLimitedHandlerOptions,
  // This wrapper is always async — it may await the Cloudflare binding before
  // it reaches the route — so `Response` sits inside a `Promise` in h3's
  // un-awaited return slot. Nitro unwraps it when deriving the route's type.
): EventHandler<Request, Promise<Response>> {
  // Thrown at module evaluation rather than on the first request: a missing key
  // is a wiring mistake, and a route that fails to build is far easier to find
  // than one that silently stops limiting in production.
  const declared = resolveRoutePolicy(options, undefined)
  const store = options.store ?? sharedRateLimitWindowStore
  const clock = options.now ?? (() => Date.now())

  // Both explicit `Promise<Response>` annotations below are load-bearing. h3's
  // `Response` slot is the un-awaited return type, and left to infer, an async
  // wrapper's result comes out as `Promise<Awaited<Response>>` — which TypeScript
  // cannot prove equals `Promise<Response>` for an unresolved type parameter.
  // The annotations state the contract instead of inferring it.
  const run = async (event: H3Event<Request>): Promise<Response> => handler(event)

  const limited = async (event: H3Event<Request>): Promise<Response> => {
    const config = readRateLimitConfig(event)
    const policy = config ? resolveRoutePolicy(options, config) : declared

    if (!policy.enabled) return run(event)

    const path = event.path ?? '/'
    if (isRateLimitExemptPath(path, resolveExemptPaths(config))) return run(event)

    const identity = getClientIp(event)
    const counterKey = rateLimitCounterKey(policy, identity, path)

    // The window is consumed even when the binding denies, so one request is
    // one count in both layers and the published `RateLimit-Remaining` stays
    // consistent with what the next request will actually be allowed.
    const windowVerdict = store.consume(
      counterKey,
      policy.limit,
      policy.windowSeconds * 1000,
      clock(),
    )

    let allowed = windowVerdict.allowed
    let enforcedBy: 'binding' | 'window' = 'window'

    const binding = readBinding(event, policy)
    if (binding) {
      try {
        const { success } = await binding.limit({ key: counterKey })
        if (!success && allowed) {
          allowed = false
          enforcedBy = 'binding'
        }
      } catch {
        // A binding that errors must not take the route down with it; the
        // in-isolate window has already produced a verdict to fall back on.
      }
    }

    const verdict: RateLimitVerdict = allowed
      ? windowVerdict
      : {
          allowed: false,
          limit: policy.limit,
          // The binding exposes no counter, so on its denial the honest
          // published remaining is zero and the honest wait is the full window.
          remaining: 0,
          resetSeconds: windowVerdict.resetSeconds,
          retryAfterSeconds: windowVerdict.retryAfterSeconds ?? policy.windowSeconds,
        }

    for (const [name, value] of Object.entries(
      buildRateLimitHeaders(policy.headers, policy.key, policy.windowSeconds, verdict),
    )) {
      setResponseHeader(event, name, value)
    }

    if (allowed) return run(event)

    // Re-assert the correlation id: the 429 is produced by Nitro's error
    // handler rather than by this handler's return, and a client reporting a
    // throttle is only actionable if its id matches the server's record.
    ensureRequestId(event)
    logDenial(event, policy, verdict, enforcedBy)

    // A 429 must never be storable at a shared cache (narduk-libs#429): the
    // `error-cache` Nitro plugin covers every thrown error as a backstop, but
    // this route already knows it is about to throw, so it sets the posture
    // itself rather than relying only on the backstop. `Retry-After` and the
    // `RateLimit-*` family set above are not in the shared-cache strip list,
    // so they survive.
    applyNoStoreToEvent(event)

    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: 'Too many requests. Please try again later.',
    })
  }

  return defineEventHandler<Request, Promise<Response>>(limited)
}
