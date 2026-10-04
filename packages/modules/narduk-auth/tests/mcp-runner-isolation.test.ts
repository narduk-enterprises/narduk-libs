import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { expect, it, vi } from 'vitest'

const ISSUER = 'https://ops.nardukenterprises.com'
const RESOURCE = 'https://runner-hooks.nard.uk/mcp'
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    public: { appUrl: ISSUER },
    authMcpOAuth: {
      enabled: true,
      resourceUri: RESOURCE,
      scopes: ['runner:transitions:read', 'runner:events:subscribe'],
      requiredScopes: ['runner:transitions:read'],
      accessTokenTtl: 3600,
      refreshTokenTtl: 604800,
      refreshTokenIdleTtl: 86400,
    },
  }),
}))
vi.mock('../server/utils/auth-bridge-database', () => ({ useAuthBridgeDatabase: () => ({}) }))
vi.mock('../server/lib/app-auth/session', () => ({
  loadAuthUserRow: () => {
    throw new Error('Must not load local principal')
  },
}))
const { defineMcpOAuthPolicy, resolveMcpOAuthPrincipal, useMcpOAuth } =
  await import('../server/utils/mcp-oauth')
const guard = (await import('../server/mcp-oauth/resource-guard')).default
const metadata = (await import('../server/mcp-oauth/protected-resource-metadata')).default
defineMcpOAuthPolicy({
  runner: { subject: 'synthetic-owner', clientId: 'synthetic-client', eligible: async () => true },
})
const request = (path: string, method = 'GET') =>
  new Request(`${ISSUER}${path}`, {
    method,
    headers: {
      authorization: 'Bearer synthetic-owner:synthetic-grant:synthetic-token',
      cookie: 'synthetic-session=present',
    },
  })

it('external resource metadata is not advertised as a Portal resource', async () => {
  const handler = toWebHandler(createApp().use(metadata))
  expect((await handler(request('/.well-known/oauth-protected-resource/mcp'))).status).toBe(404)
  expect((await handler(request('/.well-known/oauth-protected-resource'))).status).toBe(404)
})
it('local MCP resource remains closed for every method and credential type', async () => {
  const handler = toWebHandler(
    createApp()
      .use(guard)
      .use(() => ({ unexpected: true })),
  )
  for (const method of ['GET', 'POST', 'OPTIONS', 'DELETE']) {
    expect((await handler(request('/mcp', method))).status).toBe(404)
  }
})
it('external token cannot become a Portal write principal or fall back to a cookie', async () => {
  const handler = toWebHandler(
    createApp().use(
      defineEventHandler(async (event) => {
        const principal = await resolveMcpOAuthPrincipal(event)
        return { unexpected: principal ?? 'cookie-fallback' }
      }),
    ),
  )
  expect((await handler(request('/api/decisions/answer', 'POST'))).status).toBe(401)
})
it('issuer metadata still belongs to Portal and names only the external audience', async () => {
  const handler = toWebHandler(
    createApp().use(
      defineEventHandler((event) =>
        useMcpOAuth(event).fetch(request('/.well-known/oauth-authorization-server')),
      ),
    ),
  )
  const response = await handler(request('/.well-known/oauth-authorization-server'))
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    authorization_endpoint: string
    issuer: string
    protected_resources?: string[]
  }
  expect(body.issuer).toBe(ISSUER)
  expect(body.authorization_endpoint).toBe(`${ISSUER}/oauth/authorize`)
})
