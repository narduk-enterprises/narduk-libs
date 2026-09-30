import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'

import { listMcpOAuthGrants, useMcpOAuth } from '../utils/mcp-oauth'
import { resolveRequestPrincipal } from '../utils/request-principal'

/** Disconnect one of the signed-in user's apps: its grant and every token it holds. */
export default defineEventHandler(async (event): Promise<{ revoked: true }> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const principal = await resolveRequestPrincipal(event)
  if (!principal) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[\w-]{1,128}$/u.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid app id.' })
  }
  const owned = await listMcpOAuthGrants(event, principal.userId)
  if (!owned.some((grant) => grant.id === id)) {
    throw createError({ statusCode: 404, statusMessage: 'No such connected app.' })
  }
  await useMcpOAuth(event).api().revokeGrant(id, principal.userId)
  return { revoked: true }
})
