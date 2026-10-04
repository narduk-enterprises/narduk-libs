import { AuthorizationError } from '@cloudflare/workers-oauth-provider'
import {
  appendResponseHeader,
  createError,
  defineEventHandler,
  getHeader,
  getRequestHost,
  readBody,
  setResponseHeader,
} from 'h3'
import { z } from 'zod'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import { loadAuthUserRow } from '../lib/app-auth/session'
import {
  assertMcpOAuthRequest,
  authorizeMcpOAuthRequest,
  mcpOAuthConsentOwner,
  useMcpOAuth,
} from '../utils/mcp-oauth'
import { resolveRequestPrincipal } from '../utils/request-principal'

const decisionSchema = z.object({
  handle: z.string().min(1).max(200),
  decision: z.enum(['approve', 'deny']),
})

/**
 * The user's answer on the consent page. Requires the signed-in user, a
 * same-origin browser POST (plus narduk-core's X-Requested-With check), and
 * the one-use handle whose binding cookie this browser holds. The request
 * that is completed is the one stored server-side, never anything the form
 * sends; the returned redirect is the client's validated redirect URI.
 */
export default defineEventHandler(async (event): Promise<{ redirectTo: string }> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  await enforceRateLimitPolicy(event, RATE_LIMIT_POLICIES.authLogin)
  const mcp = useMcpOAuth(event)
  const origin = getHeader(event, 'origin')
  // The browser's Origin is the CSRF control; the Host check keeps a consent
  // from completing on another hostname the Worker answers (e.g. workers.dev).
  if (origin !== mcp.config.issuer || getRequestHost(event) !== new URL(mcp.config.issuer).host) {
    throw createError({ statusCode: 403, statusMessage: 'Connect apps from this site only.' })
  }
  const principal = await resolveRequestPrincipal(event, { refuseNeedsPasswordSetup: true })
  if (!principal) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in before connecting an app.' })
  }
  const parsed = decisionSchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid decision.' })
  const { handle, decision } = parsed.data
  // Only the user who opened this consent may decide it.
  if ((await mcpOAuthConsentOwner(mcp, handle)) !== principal.userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This sign-in page expired or was already used. Start again from the app.',
    })
  }

  const api = mcp.api()
  const browser = new Request(mcp.config.authorizeEndpoint, {
    method: 'POST',
    headers: { cookie: getHeader(event, 'cookie') ?? '' },
  })
  const forwardCookies = (headers: Headers) => {
    for (const cookie of headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)
  }
  try {
    if (decision === 'deny') {
      const denied = await api.denyConsent(browser, handle)
      forwardCookies(denied.headers)
      return { redirectTo: denied.redirectTo }
    }
    const approved = await api.approveConsent(browser, handle)
    forwardCookies(approved.headers)
    const scopes = assertMcpOAuthRequest(mcp, approved.request)
    const details = await api.describeConsent(approved.request)
    const row = await loadAuthUserRow(event, principal.userId)
    const refusal = await authorizeMcpOAuthRequest(mcp, approved.request, {
      event,
      user: { id: principal.userId, email: principal.email, name: row?.name ?? null },
      client: {
        id: details.clientId,
        name: details.clientName,
        ...(details.clientDomain ? { domain: details.clientDomain } : {}),
      },
      scopes,
    })
    if (refusal) throw createError({ statusCode: 403, statusMessage: refusal })
    const { redirectTo } = await api.completeAuthorization({
      request: approved.request,
      userId: principal.userId,
      metadata: { clientName: details.clientName },
      scope: scopes,
      props: {
        userId: principal.userId,
        clientId: details.clientId,
        clientName: details.clientName,
      },
    })
    return { redirectTo }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'This sign-in page expired or was already used. Start again from the app.',
      })
    }
    throw error
  }
})
