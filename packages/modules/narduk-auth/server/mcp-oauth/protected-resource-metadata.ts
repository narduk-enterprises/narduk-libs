import { createError, defineEventHandler, getRequestURL, setResponseHeaders } from 'h3'

import { MCP_OAUTH_PRM_PATH } from '../lib/mcp-oauth/core'
import { useMcpOAuth } from '../utils/mcp-oauth'

/**
 * RFC 9728 protected resource metadata, at both the path-suffixed location
 * MCP clients try first (`/.well-known/oauth-protected-resource/mcp`) and the
 * root fallback.
 */
export default defineEventHandler((event) => {
  const mcp = useMcpOAuth(event)
  if (mcp.config.resource !== `${mcp.config.issuer}${mcp.config.resourcePath}`) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const suffix = getRequestURL(event).pathname.slice(MCP_OAUTH_PRM_PATH.length)
  if (suffix !== '' && suffix !== '/' && suffix !== mcp.config.resourcePath) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  })
  if (event.method === 'OPTIONS') return ''
  return mcp.protectedResourceMetadata()
})
