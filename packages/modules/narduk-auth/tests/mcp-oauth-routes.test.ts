import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { createApp, createRouter, defineEventHandler, getHeader, toWebHandler } from 'h3'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

const ISSUER = 'https://family.example'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const SCOPE = 'family:read'
const USERS: Record<string, { email: string; id: string; name: string | null }> = {
  owner: { id: 'owner', email: 'owner@family.example', name: 'Logan' },
  other: { id: 'other', email: 'other@family.example', name: 'Sam' },
}

const holder: { db?: ReturnType<typeof drizzle> } = {}

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: <T>(plugin: T) => plugin,
  useRuntimeConfig: () => ({
    authBackend: 'local',
    authMcpOAuth: {
      enabled: true,
      resourceName: 'Family',
      scopes: [SCOPE],
      requiredScopes: [SCOPE],
    },
    public: { appUrl: ISSUER },
  }),
}))
vi.mock('../server/utils/auth-bridge-database', () => ({
  useAuthBridgeDatabase: () => holder.db,
}))
vi.mock('../server/lib/app-auth/session', () => ({
  loadAuthUserRow: (_event: unknown, id: string) => Promise.resolve(USERS[id] ?? null),
}))
// The signed-in browser user, from a test header (the real resolver reads the session cookie).
vi.mock('../server/utils/request-principal', () => ({
  resolveRequestPrincipal: (event: H3Event) => {
    const id = getHeader(event, 'x-test-user')
    const user = id ? USERS[id] : undefined
    return Promise.resolve(
      user
        ? {
            userId: user.id,
            email: user.email,
            method: 'session',
            apiKeyScopes: [],
            emailVerified: true,
          }
        : null,
    )
  },
}))

const { defineMcpOAuthPolicy, mcpOAuthUnauthorized, resolveMcpOAuthPrincipal } =
  await import('../server/utils/mcp-oauth')
const protocol = (await import('../server/mcp-oauth/protocol')).default
const metadata = (await import('../server/mcp-oauth/protected-resource-metadata')).default
const consentGet = (await import('../server/mcp-oauth/consent.get')).default
const consentPost = (await import('../server/mcp-oauth/consent.post')).default
const grantsGet = (await import('../server/mcp-oauth/grants.get')).default
const grantDelete = (await import('../server/mcp-oauth/grant.delete')).default
const resourceGuard = (await import('../server/mcp-oauth/resource-guard')).default

/**
 * The app's MCP route: OAuth first, API keys after, and (as a careless app
 * might) a session fallback that the resource guard must keep unreachable.
 */
const mcpRoute = defineEventHandler(async (event) => {
  const principal = await resolveMcpOAuthPrincipal(event)
  if (principal)
    return { via: 'oauth', attribution: principal.attribution, scopes: principal.scopes }
  if (getHeader(event, 'authorization')?.startsWith('Bearer nk_')) return { via: 'api-key' }
  if (getHeader(event, 'x-test-user')) return { via: 'session' }
  throw mcpOAuthUnauthorized(event)
})

const router = createRouter()
  .use('/.well-known/oauth-authorization-server', protocol)
  .use('/oauth/token', protocol)
  .use('/oauth/register', protocol)
  .use('/.well-known/oauth-protected-resource', metadata)
  .use('/.well-known/oauth-protected-resource/**', metadata)
  .get('/api/auth/mcp/consent', consentGet)
  .post('/api/auth/mcp/consent', consentPost)
  .get('/api/auth/mcp/grants', grantsGet)
  .delete('/api/auth/mcp/grants/:id', grantDelete)
  .post('/mcp', mcpRoute)
const handle = toWebHandler(createApp().use(resourceGuard).use(router))
const call = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('host', new URL(ISSUER).host)
  return handle(new Request(`${ISSUER}${path}`, { ...init, headers }))
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function registerRaw(overrides: Record<string, unknown> = {}) {
  return call('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      ...overrides,
    }),
  })
}

async function register(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await registerRaw(overrides)
  expect(response.status).toBe(201)
  return ((await response.json()) as { client_id: string }).client_id
}

async function authorizeQuery(clientId: string, overrides: Record<string, string | null> = {}) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: SCOPE,
    resource: `${ISSUER}/mcp`,
  })
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) query.delete(name)
    else query.set(name, value)
  }
  return { verifier, query: `?${query}` }
}

async function openConsent(query: string) {
  const response = await call(`/api/auth/mcp/consent${query}`, {
    headers: { 'x-test-user': 'owner' },
  })
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  return { body: (await response.json()) as Record<string, unknown>, cookie }
}

function decide(
  handleValue: string,
  cookie: string,
  decision: 'approve' | 'deny',
  origin = ISSUER,
  user = 'owner',
) {
  return call('/api/auth/mcp/consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      origin,
      'x-test-user': user,
    },
    body: JSON.stringify({ handle: handleValue, decision }),
  })
}

function exchange(clientId: string, code: string, verifier: string) {
  return call('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${ISSUER}/mcp`,
    }),
  })
}

/** register → consent (approve): the client's code and verifier. */
async function approvedCode(overrides: Record<string, string | null> = {}) {
  const clientId = await register()
  const { verifier, query } = await authorizeQuery(clientId, overrides)
  const consent = await openConsent(query)
  expect(consent.body.status).toBe('consent')
  const approved = await decide(String(consent.body.handle), consent.cookie, 'approve')
  expect(approved.status).toBe(200)
  const redirect = new URL(((await approved.json()) as { redirectTo: string }).redirectTo)
  expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK)
  expect(redirect.searchParams.get('iss')).toBe(ISSUER)
  return { clientId, verifier, code: redirect.searchParams.get('code')! }
}

/** register → consent (approve) → token exchange, all over HTTP. */
async function connect(overrides: Record<string, string | null> = {}) {
  const { clientId, verifier, code } = await approvedCode(overrides)
  const token = await exchange(clientId, code, verifier)
  expect(token.status).toBe(200)
  return {
    clientId,
    ...((await token.json()) as { access_token: string; refresh_token: string; scope: string }),
  }
}

const mcp = (authorization?: string) =>
  call('/mcp', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: '{}',
  })

describe('MCP OAuth routes', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })

  beforeAll(async () => {
    const binding = await runtime.getD1Database('DB')
    const statements = readFileSync(
      new URL('../drizzle/0005_mcp_oauth.sql', import.meta.url),
      'utf8',
    )
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
    await binding.batch(statements.map((item) => binding.prepare(item)))
    holder.db = drizzle(binding)
  })
  afterAll(() => runtime.dispose())
  beforeEach(() => defineMcpOAuthPolicy({}))

  it('serves protected resource metadata at the path-suffixed and root locations', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const response = await call(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        resource: `${ISSUER}/mcp`,
        authorization_servers: [ISSUER],
        scopes_supported: [SCOPE],
      })
    }
    expect((await call('/.well-known/oauth-protected-resource/other')).status).toBe(404)
  })

  it('serves authorization server metadata for the issuer', async () => {
    const response = await call('/.well-known/oauth-authorization-server')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      code_challenge_methods_supported: ['S256'],
    })
  })

  it('answers an MCP call without credentials with the RFC 9728 challenge', async () => {
    const response = await mcp()
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`,
    )
  })

  it('connects over HTTP and acts as the user, attributed to the client', async () => {
    const { access_token: token } = await connect()
    const response = await mcp(`Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      via: 'oauth',
      attribution: 'Claude for Logan',
      scopes: [SCOPE],
    })
  })

  it('uses the app attribution hook when one is registered', async () => {
    defineMcpOAuthPolicy({
      attribution: ({ clientName, user }) => `${user.email} via ${clientName}`,
    })
    const { access_token: token } = await connect()
    expect(await (await mcp(`Bearer ${token}`)).json()).toMatchObject({
      attribution: 'owner@family.example via Claude',
    })
  })

  it('leaves API-key bearers to the existing path', async () => {
    const response = await mcp('Bearer nk_1234567890abcdef')
    expect(await response.json()).toEqual({ via: 'api-key' })
  })

  it('refuses an unknown bearer with invalid_token, never a session fallback', async () => {
    const response = await mcp('Bearer owner:grant:not-a-real-secret')
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('asks a signed-out visitor to log in before showing anything', async () => {
    const clientId = await register()
    const { query } = await authorizeQuery(clientId)
    const response = await call(`/api/auth/mcp/consent${query}`)
    expect(await response.json()).toEqual({ status: 'login' })
  })

  it('refuses a consent POST from another origin', async () => {
    const clientId = await register()
    const consent = await openConsent((await authorizeQuery(clientId)).query)
    const response = await decide(
      String(consent.body.handle),
      consent.cookie,
      'approve',
      'https://evil.example',
    )
    expect(response.status).toBe(403)
  })

  it('refuses a consent POST without the browser binding cookie, and a replayed handle', async () => {
    const clientId = await register()
    const consent = await openConsent((await authorizeQuery(clientId)).query)
    expect((await decide(String(consent.body.handle), '', 'approve')).status).toBe(400)
    expect((await decide(String(consent.body.handle), consent.cookie, 'approve')).status).toBe(200)
    expect((await decide(String(consent.body.handle), consent.cookie, 'approve')).status).toBe(400)
  })

  it('sends access_denied, state and iss back to the client when the user declines', async () => {
    const clientId = await register()
    const consent = await openConsent((await authorizeQuery(clientId)).query)
    const response = await decide(String(consent.body.handle), consent.cookie, 'deny')
    const redirect = new URL(((await response.json()) as { redirectTo: string }).redirectTo)
    expect(redirect.searchParams.get('error')).toBe('access_denied')
    expect(redirect.searchParams.get('state')).toBe('xyz')
    expect(redirect.searchParams.get('iss')).toBe(ISSUER)
  })

  it('lets the app policy refuse a user before consent', async () => {
    defineMcpOAuthPolicy({ authorize: () => 'Only family members can connect apps.' })
    const clientId = await register()
    const consent = await openConsent((await authorizeQuery(clientId)).query)
    expect(consent.body).toEqual({
      status: 'error',
      message: 'Only family members can connect apps.',
    })
  })

  it('shows an invalid redirect as an error on the page, never a redirect', async () => {
    const clientId = await register()
    const { query } = await authorizeQuery(clientId)
    const tampered = query.replace(
      encodeURIComponent(CALLBACK),
      encodeURIComponent('https://evil.example/cb'),
    )
    const consent = await openConsent(tampered)
    expect(consent.body.status).toBe('error')
    expect(consent.body.redirectTo).toBeUndefined()
  })

  it('lists connected apps and revokes one, killing its tokens', async () => {
    const { access_token: token } = await connect()
    const list = await call('/api/auth/mcp/grants', { headers: { 'x-test-user': 'owner' } })
    const { apps } = (await list.json()) as { apps: Array<{ clientName: string; id: string }> }
    expect(apps.length).toBeGreaterThan(0)
    expect(apps[0]?.clientName).toBe('Claude')
    const grantId = token.split(':')[1]!
    expect(apps.some((app) => app.id === grantId)).toBe(true)

    expect(
      (
        await call('/api/auth/mcp/grants/not-mine', {
          method: 'DELETE',
          headers: { 'x-test-user': 'owner' },
        })
      ).status,
    ).toBe(404)
    const revoked = await call(`/api/auth/mcp/grants/${grantId}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'owner' },
    })
    expect(revoked.status).toBe(200)
    expect((await mcp(`Bearer ${token}`)).status).toBe(401)
    expect((await call('/api/auth/mcp/grants')).status).toBe(401)
  })

  it('keeps a cookie-only POST to the resource path away from the app route', async () => {
    const response = await call('/mcp', {
      method: 'POST',
      headers: { 'x-test-user': 'owner' },
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
  })

  it('refuses a scope the server does not offer, back to the client as invalid_scope', async () => {
    const clientId = await register()
    const { query } = await authorizeQuery(clientId, { scope: `${SCOPE} family:admin` })
    const consent = await openConsent(query)
    expect(consent.body.status).toBe('error')
    const redirect = new URL(String(consent.body.redirectTo))
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK)
    expect(redirect.searchParams.get('error')).toBe('invalid_scope')
    expect(redirect.searchParams.get('iss')).toBe(ISSUER)
  })

  it('grants the required scopes when the client asks for none', async () => {
    const { access_token: token } = await connect({ scope: null })
    expect(await (await mcp(`Bearer ${token}`)).json()).toMatchObject({ scopes: [SCOPE] })
  })

  it('requires PKCE from confidential clients too', async () => {
    const response = await registerRaw({ token_endpoint_auth_method: 'client_secret_post' })
    expect(response.status).toBe(201)
    const { client_id: clientId } = (await response.json()) as { client_id: string }
    const { query } = await authorizeQuery(clientId, {
      code_challenge: null,
      code_challenge_method: null,
    })
    const consent = await openConsent(query)
    expect(consent.body.status).toBe('error')
    expect(new URL(String(consent.body.redirectTo)).searchParams.get('error')).toBe(
      'invalid_request',
    )
  })

  it('refuses to register a remote http or custom-scheme redirect URI', async () => {
    for (const uri of ['http://evil.example/cb', 'myapp://cb', 'https://ok.example/cb#frag']) {
      const response = await registerRaw({ redirect_uris: [CALLBACK, uri] })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' })
    }
    expect((await registerRaw({ redirect_uris: ['http://127.0.0.1:8976/cb'] })).status).toBe(201)
  })

  it('lets only the user who opened a consent decide it', async () => {
    const clientId = await register()
    const consent = await openConsent((await authorizeQuery(clientId)).query)
    const response = await decide(
      String(consent.body.handle),
      consent.cookie,
      'approve',
      ISSUER,
      'other',
    )
    expect(response.status).toBe(400)
  })

  it('redeems an authorization code once even when exchanges race', async () => {
    const { clientId, verifier, code } = await approvedCode()
    const statuses = await Promise.all(
      [1, 2, 3].map(async () => (await exchange(clientId, code, verifier)).status),
    )
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
  })

  it('answers a metadata-document client it cannot fetch with an error, not a 500', async () => {
    const { query } = await authorizeQuery('https://client.example/oauth/client.json')
    const consent = await openConsent(query)
    expect(consent.body.status).toBe('error')
    expect(consent.body.redirectTo).toBeUndefined()
  })
})
