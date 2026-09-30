import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider'
import { appendResponseHeader, defineEventHandler, getRequestURL, setResponseHeaders } from 'h3'

import { loadAuthUserRow } from '../lib/app-auth/session'
import { mcpOAuthPolicy, useMcpOAuth } from '../utils/mcp-oauth'
import { resolveRequestPrincipal } from '../utils/request-principal'

import type { McpOAuthConsentState } from '../../shared/types/mcp-oauth'

/**
 * Validates the authorization request the consent page received (its query,
 * passed through verbatim), for the signed-in user, and opens a one-use
 * consent transaction bound to this browser by a `__Host-` cookie.
 */
export default defineEventHandler(async (event): Promise<McpOAuthConsentState> => {
  setResponseHeaders(event, { 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'DENY' })
  const mcp = useMcpOAuth(event)
  const principal = await resolveRequestPrincipal(event, { refuseNeedsPasswordSetup: true })
  if (!principal) return { status: 'login' }

  const search = getRequestURL(event).search
  const api = mcp.api()
  try {
    const request = await api.parseAuthRequest(
      new Request(`${mcp.config.authorizeEndpoint}${search}`),
    )
    const details = await api.describeConsent(request)
    const row = await loadAuthUserRow(event, principal.userId)
    const user = { id: principal.userId, email: principal.email, name: row?.name ?? null }
    const client = {
      id: details.clientId,
      name: details.clientName,
      ...(details.clientDomain ? { domain: details.clientDomain } : {}),
    }
    const refusal = await mcpOAuthPolicy().authorize?.({
      event,
      user,
      client,
      scopes: request.scope,
    })
    if (refusal) return { status: 'error', message: refusal }

    const transaction = await api.beginConsent(request)
    for (const cookie of transaction.headers.getSetCookie()) {
      appendResponseHeader(event, 'set-cookie', cookie)
    }
    return {
      status: 'consent',
      handle: transaction.handle,
      client: { ...client, ...(details.clientUri ? { uri: details.clientUri } : {}) },
      redirectHost: details.redirectHost,
      redirectIsLoopback: details.redirectIsLoopback,
      scopes: details.scope,
      resource: request.resource ?? mcp.config.resource,
      account: { email: user.email, name: user.name },
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        status: 'error',
        message: error.description || 'This sign-in request is not valid.',
        ...(error.redirectTo ? { redirectTo: error.redirectTo } : {}),
      }
    }
    if (error instanceof CimdFetchError) {
      return { status: 'error', message: 'This app could not be verified. Try again later.' }
    }
    throw error
  }
})
