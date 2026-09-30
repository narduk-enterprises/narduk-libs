import { defineEventHandler, getRequestURL, setResponseHeader, setResponseStatus } from 'h3'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import { MCP_OAUTH_REGISTER_PATH, MCP_OAUTH_TOKEN_PATH } from '../lib/mcp-oauth/core'
import { isAllowedMcpOAuthRedirectUri } from '../lib/mcp-oauth/redirect-uri'
import {
  claimMcpOAuthCode,
  mcpOAuthExecutionContext,
  mcpOAuthWebRequest,
  sendMcpOAuthResponse,
  useMcpOAuth,
} from '../utils/mcp-oauth'

import type { H3Event } from 'h3'

function oauthError(event: H3Event, status: number, error: string, description: string) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return JSON.stringify({ error, error_description: description })
}

/** The request's body as the client sent it, read without consuming the original. */
async function formField(request: Request, name: string): Promise<string | null> {
  const type = request.headers.get('content-type') ?? ''
  if (!type.includes('application/x-www-form-urlencoded')) return null
  const value = new URLSearchParams(await request.clone().text()).get(name)
  return value || null
}

async function redirectUris(request: Request): Promise<unknown> {
  try {
    const body = (await request.clone().json()) as { redirect_uris?: unknown }
    return body?.redirect_uris
  } catch {
    return undefined
  }
}

/**
 * Protocol-owned endpoints served by @cloudflare/workers-oauth-provider:
 * RFC 8414 metadata, the token endpoint (codes, refresh rotation, RFC 7009
 * revocation) and RFC 7591 registration. Registered only when
 * `nardukAuth.mcpOAuth.enabled`; CSRF-exempt because they take no cookie.
 * narduk-auth adds: https-or-loopback redirect URIs at registration, and an
 * atomic one-time claim of each authorization code before it is redeemed.
 */
export default defineEventHandler(async (event) => {
  const mcp = useMcpOAuth(event)
  const path = getRequestURL(event).pathname
  if (event.method !== 'GET' && event.method !== 'OPTIONS') {
    await enforceRateLimitPolicy(
      event,
      path === MCP_OAUTH_REGISTER_PATH
        ? RATE_LIMIT_POLICIES.authRegister
        : RATE_LIMIT_POLICIES.authApiKeys,
    )
  }
  const ctx = mcpOAuthExecutionContext(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const request = await mcpOAuthWebRequest(event, mcp)

  if (path === MCP_OAUTH_REGISTER_PATH && request.method === 'POST') {
    const uris = await redirectUris(request)
    if (Array.isArray(uris) && !uris.every(isAllowedMcpOAuthRedirectUri)) {
      return oauthError(
        event,
        400,
        'invalid_redirect_uri',
        'Redirect URIs must use https, or http on a loopback address.',
      )
    }
  }

  if (path === MCP_OAUTH_TOKEN_PATH && request.method === 'POST') {
    ctx.waitUntil(mcp.kv.purgeExpired())
    const code =
      (await formField(request, 'grant_type')) === 'authorization_code'
        ? await formField(request, 'code')
        : null
    if (code && !(await claimMcpOAuthCode(mcp, code))) {
      return oauthError(event, 400, 'invalid_grant', 'The authorization code was already used.')
    }
  }

  try {
    return await sendMcpOAuthResponse(event, await mcp.fetch(request, ctx))
  } catch {
    // The library throws a plain Error for a metadata-document client it cannot
    // fetch here; answer as OAuth, never a 500 with a stack.
    return oauthError(event, 400, 'invalid_client', 'The client could not be identified.')
  }
})
