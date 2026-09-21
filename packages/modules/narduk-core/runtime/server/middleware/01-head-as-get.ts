import { defineEventHandler, getRequestHeader, getRequestIP } from 'h3'

import { CF_CONNECTING_IP_HEADER } from '../utils/client-ip'

import type { H3Event } from 'h3'

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
 * headers and both headers `getClientIp` reads all survive the hop untouched.
 */
function innerRequestHeaders(event: H3Event): Record<string, string> {
  const headers: Record<string, string> = { [REENTRY_HEADER]: '1' }

  // `getProxyRequestHeaders` drops `accept` from what it forwards, and content negotiation is part
  // of what makes a HEAD identical to its GET, so put it back.
  const accept = getRequestHeader(event, 'accept')
  if (accept) headers.accept = accept

  // A caller identified by a header keeps its identity for free. A caller identified only by its
  // socket does not: the inner request has no socket, and `event.context` is rebuilt rather than
  // shared, so the inner `getRequestIP` returns undefined. That matters because
  // `rate-limit/policy.ts` keys an unidentifiable caller as the literal `'unknown'` -- deliberately,
  // so an unknown caller is limited rather than unlimited -- and every HEAD in the deployment would
  // then share that one bucket, letting one client's HEAD traffic exhaust an allowance held in
  // common with everyone else.
  //
  // So carry the socket address across, and only the socket address: `getRequestIP` without
  // `xForwardedFor` reads `event.context.clientAddress` and the socket, neither of which the client
  // chooses. Forwarding a client-chosen address instead would let a HEAD spend a victim's
  // allowance. Nothing is synthesised when the request already carries `cf-connecting-ip`, so a
  // real one is never overridden. `x-forwarded-for` alone does not count as already resolved:
  // `getClientIp` (`client-ip.ts`) only reads it when a caller opts in with `trustForwardedFor`,
  // which defaults off, so by default an `x-forwarded-for`-only request resolves through the
  // socket on both the outer request and this synthesised inner one -- exactly like a direct GET
  // -- rather than falling to `'unknown'` because the inner event has no socket of its own.
  const carriesCfConnectingIp = Boolean(getRequestHeader(event, CF_CONNECTING_IP_HEADER)?.trim())
  if (!carriesCfConnectingIp) {
    const socketAddress = getRequestIP(event)
    if (socketAddress) headers[CF_CONNECTING_IP_HEADER] = socketAddress
  }

  return headers
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

  const inner = await event.fetch(event.path, {
    method: 'GET',
    headers: innerRequestHeaders(event),
  })
  const response = headOnlyResponse(inner)
  try {
    await inner.body?.cancel()
  } catch {
    // The inner body is being discarded either way; a refused cancel is not worth failing a HEAD.
  }
  return response
})
