import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import { MCP_OAUTH_REGISTER_PATH, MCP_OAUTH_TOKEN_PATH } from '../lib/mcp-oauth/core'
import {
  mcpOAuthExecutionContext,
  mcpOAuthWebRequest,
  sendMcpOAuthResponse,
  useMcpOAuth,
} from '../utils/mcp-oauth'

/**
 * Protocol-owned endpoints served by @cloudflare/workers-oauth-provider:
 * RFC 8414 metadata, the token endpoint (codes, refresh rotation, RFC 7009
 * revocation) and RFC 7591 registration. Registered only when
 * `nardukAuth.mcpOAuth.enabled`; CSRF-exempt because they take no cookie.
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
  if (path === MCP_OAUTH_TOKEN_PATH) ctx.waitUntil(mcp.kv.purgeExpired())
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return sendMcpOAuthResponse(event, await mcp.fetch(await mcpOAuthWebRequest(event, mcp), ctx))
})
