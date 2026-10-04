import { createError, defineEventHandler, getHeader, getRequestURL } from 'h3'

import { mcpOAuthConfig, mcpOAuthUnauthorized } from '../utils/mcp-oauth'

const BEARER = /^bearer\s+\S+$/iu
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The MCP resource path is exempt from narduk-core's X-Requested-With check
 * so OAuth clients can call it, which makes a cookie there unsafe. Every
 * mutating request to it must carry a bearer credential (an OAuth access
 * token or an API key); without one it gets the 401 challenge that starts
 * MCP sign-in, before any app handler can fall back to the session cookie.
 */
export default defineEventHandler((event) => {
  const config = mcpOAuthConfig(event)
  if (!config || getRequestURL(event).pathname !== config.resourcePath) return
  if (config.resource !== `${config.issuer}${config.resourcePath}`) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  if (SAFE_METHODS.has(event.method.toUpperCase())) return
  if (!BEARER.test(getHeader(event, 'authorization')?.trim() ?? '')) {
    throw mcpOAuthUnauthorized(event)
  }
})
