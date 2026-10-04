import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider'
import {
  appendResponseHeader,
  defineEventHandler,
  getRequestURL,
  isError,
  setResponseHeaders,
} from 'h3'

import { loadAuthUserRow } from '../lib/app-auth/session'
import {
  assertMcpOAuthRequest,
  authorizeMcpOAuthRequest,
  bindMcpOAuthConsent,
  useMcpOAuth,
} from '../utils/mcp-oauth'
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
    const scopes = assertMcpOAuthRequest(mcp, request)
    const details = await api.describeConsent(request)
    const row = await loadAuthUserRow(event, principal.userId)
    const user = { id: principal.userId, email: principal.email, name: row?.name ?? null }
    const client = {
      id: details.clientId,
      name: details.clientName,
      ...(details.clientDomain ? { domain: details.clientDomain } : {}),
    }
    const refusal = await authorizeMcpOAuthRequest(mcp, request, {
      event,
      user,
      client,
      scopes,
    })
    if (refusal) return { status: 'error', message: refusal }

    const transaction = await api.beginConsent(request)
    await bindMcpOAuthConsent(mcp, transaction.handle, principal.userId)
    for (const cookie of transaction.headers.getSetCookie()) {
      appendResponseHeader(event, 'set-cookie', cookie)
    }
    return {
      status: 'consent',
      handle: transaction.handle,
      client: { ...client, ...(details.clientUri ? { uri: details.clientUri } : {}) },
      redirectHost: details.redirectHost,
      redirectIsLoopback: details.redirectIsLoopback,
      scopes,
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
    if (isError(error)) throw error
    // CimdFetchError, or the library's plain Error for a metadata-document
    // client it cannot fetch here: never a 500, never a redirect.
    return {
      status: 'error',
      message:
        error instanceof CimdFetchError
          ? 'This app could not be verified. Try again later.'
          : 'This app could not be identified. Start again from the app.',
    }
  }
})
