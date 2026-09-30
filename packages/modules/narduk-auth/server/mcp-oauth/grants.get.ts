import { createError, defineEventHandler, setResponseHeader } from 'h3'

import { listMcpOAuthGrants } from '../utils/mcp-oauth'
import { resolveRequestPrincipal } from '../utils/request-principal'

import type { McpOAuthConnectedApp } from '../../shared/types/mcp-oauth'

/** The signed-in user's connected apps (live OAuth grants). */
export default defineEventHandler(async (event): Promise<{ apps: McpOAuthConnectedApp[] }> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const principal = await resolveRequestPrincipal(event)
  if (!principal) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const apps: McpOAuthConnectedApp[] = (await listMcpOAuthGrants(event, principal.userId)).map(
    (grant) => {
      const metadata = (grant.metadata ?? {}) as { clientName?: unknown }
      return {
        id: grant.id,
        clientId: grant.clientId,
        clientName: typeof metadata.clientName === 'string' ? metadata.clientName : grant.clientId,
        scopes: grant.scope,
        createdAt: grant.createdAt,
        ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
      }
    },
  )
  apps.sort((a, b) => b.createdAt - a.createdAt)
  return { apps }
})
