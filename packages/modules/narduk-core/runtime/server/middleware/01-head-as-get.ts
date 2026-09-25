import { defineEventHandler, getRequestHeader, getRequestIP } from 'h3'

import type { H3Event, H3EventContext } from 'h3'

/**
 * h3's router matches the request method exactly. A `*.get.ts` file route compiles to
 * `router.add(path, handler, 'get')`, which registers `handlers.get` and nothing else, so
 * `matchHandler(path, 'head')` finds neither `handlers.head` nor `handlers.all` and the request
 * falls through to a 404. Every file-based API route in a narduk app has this, including core's
 * own `/api/health` -- the path apps enrol for uptime monitoring, and the one where it was found
 * (narduk-libs#639, narduk-enterprises/buoys#281). RFC 9110 section 9.3.2 requires a HEAD response
 * to be identical to the GET's minus the body, so this is a spec violation rather than a missing
 * nicety.
 *
 * Answering HEAD by re-entering the app with GET is what keeps the two identical: a hand-written
 * HEAD handler per route would drift, and -- worse for the case that found this -- a cheap HEAD
 * that does not run the real work would report a failing health check as healthy.
 *
 * Only API paths are translated. Pages already answer HEAD, because the Nuxt renderer is
 * registered for every method, so translating them would buy nothing and pay for a second render.
 *
 * It runs second in the chain, so a translated HEAD pays for the rest of that chain -- CORS, CSRF,
 * the D1 binding, the request log -- once rather than twice. The cost of that choice is in the log:
 * `requestLogger` sees only the inner request, so a HEAD is recorded as the GET it became. The
 * inner request is identifiable by `x-narduk-head-as-get`, and keeping a liveness probe cheap is
 * worth more than a second log line saying the same thing.
 */

/**
 * Marks the GET this middleware issues, so the second pass through the chain is not translated
 * again. It is a loop guard and nothing else: a client that forges it can only make its own HEAD
 * skip the translation and 404 the way it does today, which is this fix being absent. It grants
 * no privilege, and nothing downstream reads it.
 */
const REENTRY_HEADER = 'x-narduk-head-as-get'

/**
 * Hop-by-hop headers, and the ones that frame a body this response does not have. Everything else
 * the GET produced is copied verbatim, including `set-cookie` and the cache and CORS headers that
 * a monitor or a browser reads.
 */
const SKIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

function isApiPath(path: string) {
  const pathname = path.split('?')[0] ?? path
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * The headers added on top of the ones h3 forwards for us.
 *
 * `fetchWithEvent` -- which is what `event.fetch` is -- copies the incoming request's headers
 * through `getProxyRequestHeaders`, so `cookie`, `authorization`, `origin`, the conditional
 * headers and both headers `getClientIp` reads all survive the hop untouched. No identity header
 * is added: see `innerRequestContext`.
 */
function innerRequestHeaders(event: H3Event): Record<string, string> {
  const headers: Record<string, string> = { [REENTRY_HEADER]: '1' }

  // `getProxyRequestHeaders` drops `accept` from what it forwards, and content negotiation is part
  // of what makes a HEAD identical to its GET, so put it back.
  const accept = getRequestHeader(event, 'accept')
  if (accept) headers.accept = accept

  return headers
}

/**
 * The context the inner GET starts from, carrying the caller's socket address.
 *
 * A caller identified by a header keeps its identity for free. A caller identified only by its
 * socket does not: the inner request has no socket, and `event.context` is rebuilt rather than
 * shared, so the inner `getRequestIP` would return undefined. `rate-limit/policy.ts` keys an
 * unidentifiable caller as the literal `'unknown'`, so every HEAD in the deployment would then
 * share one bucket.
 *
 * The address travels as `_platform.clientAddress`. `fetchWithEvent` hands `init.context` to
 * Nitro's local fetch, node-mock-http stores it on the inner request as `req.__unenv__`, and
 * Nitro's `onRequest` spreads `__unenv__._platform` into the inner `event.context` -- the one
 * channel known to cross (narduk-libs#683). h3's `getRequestIP` reads `event.context.clientAddress`
 * first, so the socket lands at the socket's own precedence in `getClientIp` (`client-ip.ts`):
 * after `cf-connecting-ip` and after a trusted `x-forwarded-for`, both of which cross as headers.
 * The inner request therefore resolves exactly as the outer one does, for a route that trusts
 * `x-forwarded-for` and for one that does not.
 *
 * This replaces synthesising `cf-connecting-ip` from the socket (#681), which `getClientIp` reads
 * first and unconditionally, so a route trusting `x-forwarded-for` saw a HEAD as the proxy while
 * its GET saw the client. `__unenv__` is set only by an in-process fetch; no HTTP client can reach
 * it, so no client-chosen value gains any precedence here.
 */
function innerRequestContext(event: H3Event): H3EventContext {
  const clientAddress = getRequestIP(event)
  if (!clientAddress) return event.context
  // `_platform` is typed for the Cloudflare fields this layer reads; Nitro spreads whatever it
  // holds, so widen it to add the address.
  const platform: Record<string, unknown> = { ...event.context._platform, clientAddress }
  return { ...event.context, _platform: platform }
}

function headOnlyResponse(inner: Response): Response {
  const headers = new Headers()
  inner.headers.forEach((value, name) => {
    // Walking `Headers` joins repeated `set-cookie` values into one comma-separated string, which
    // corrupts a cookie that contains a comma. They are copied from `getSetCookie` instead.
    if (name === 'set-cookie' || SKIPPED_RESPONSE_HEADERS.has(name)) return
    headers.append(name, value)
  })
  for (const cookie of inner.headers.getSetCookie?.() ?? []) {
    headers.append('set-cookie', cookie)
  }
  // h3 turns a `null` return into a 204, so the status has to be carried on a Response.
  return new Response(null, { status: inner.status, statusText: inner.statusText, headers })
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'HEAD') return
  if (!isApiPath(event.path)) return
  if (getRequestHeader(event, REENTRY_HEADER)) return
  // Nitro installs `event.fetch`; outside Nitro there is nothing to re-enter through, and
  // returning leaves today's behaviour rather than throwing a 500 at every HEAD.
  if (typeof event.fetch !== 'function') return

  // `fetchWithEvent` reads `init.context`; the Workers `RequestInit` type does not declare it.
  const init: RequestInit & { context: H3EventContext } = {
    method: 'GET',
    headers: innerRequestHeaders(event),
    context: innerRequestContext(event),
  }
  const inner = await event.fetch(event.path, init)
  const response = headOnlyResponse(inner)
  try {
    await inner.body?.cancel()
  } catch {
    // The inner body is being discarded either way; a refused cancel is not worth failing a HEAD.
  }
  return response
})
