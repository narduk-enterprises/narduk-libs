import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { createApp, createRouter, defineEventHandler, getHeader, toWebHandler } from 'h3'
import { Miniflare } from 'miniflare'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMcpOAuth, resolveMcpOAuthConfig } from '../server/lib/mcp-oauth/core'

import type { H3Event } from 'h3'

const ISSUER = 'https://ops.nardukenterprises.com'
const RESOURCE = 'https://runner-hooks.nard.uk/mcp'
const RUNNER_SCOPES = ['runner:transitions:read', 'runner:events:subscribe']
let testClient = ''
let eligible = true
const nativeAuthorize = vi.fn()
const CALLBACK = 'https://chat.example.com/oauth/callback'
const SCOPE = 'operator-portal:read'
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

const {
  defineMcpOAuthPolicy,
  defineRunnerMcpOAuthPolicy,
  mcpOAuthUnauthorized,
  resolveMcpOAuthPrincipal,
} = await import('../server/utils/mcp-oauth')
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
      client_name: 'Synthetic ChatGPT',
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

const mcp = (authorization?: string) =>
  call('/mcp', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: '{}',
  })

const nativeConfig = () =>
  resolveMcpOAuthConfig({ enabled: true, scopes: [SCOPE], requiredScopes: [SCOPE] }, ISSUER)!
const inspector = () =>
  createMcpOAuth({
    db: holder.db!,
    config: nativeConfig(),
    runnerAudience: { subject: 'owner', clientId: testClient, eligible: async () => eligible },
  })
function registerRunner() {
  defineRunnerMcpOAuthPolicy({
    subject: 'owner',
    clientId: testClient,
    eligible: async () => eligible,
  })
}
async function connectResource(resource = RESOURCE, omit = false) {
  const { verifier, query } = await authorizeQuery(testClient, {
    resource: omit ? null : resource,
    scope: resource === RESOURCE ? RUNNER_SCOPES.join(' ') : SCOPE,
  })
  const consent = await openConsent(query)
  expect(consent.body.status).toBe('consent')
  const approved = await decide(String(consent.body.handle), consent.cookie, 'approve')
  expect(approved.status).toBe(200)
  const { redirectTo } = (await approved.json()) as { redirectTo: string }
  const code = new URL(redirectTo).searchParams.get('code')!
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: CALLBACK,
    ...(omit ? {} : { resource }),
  })
  expect(token.status).toBe(200)
  return (await token.json()) as {
    access_token: string
    expires_in: number
    refresh_token: string
    scope: string
  }
}
function tokenRequest(values: Record<string, string>) {
  return call('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: testClient, ...values }),
  })
}
const ARGS = {
  source: 'liveness',
  code: 'PERSISTENT_RUNNER_MISSING',
  target: 'narduk-enterprises/linux-deploy/github-deploy-runner-1',
}
const SUBJECT = 'owner'
const KEY = Buffer.alloc(32, 29)
const SECRET = `whsec_${KEY.toString('base64')}`
async function verifyBridge(token: string, resource = RESOURCE) {
  const body = JSON.stringify({
    method: 'verifyAccessToken',
    input: { issuer: ISSUER, resource, token },
  })
  const id = randomUUID(),
    stamp = String(Math.floor(Date.now() / 1000))
  const response = await inspector().runnerBridge!(
    new Request(`${ISSUER}/api/auth/mcp/runner-bridge`, {
      method: 'POST',
      body,
      headers: {
        'webhook-id': id,
        'webhook-timestamp': stamp,
        'webhook-signature': `v1,${createHmac('sha256', KEY).update(`${id}.${stamp}.${body}`).digest('base64')}`,
      },
    }),
    SECRET,
  )
  expect(response.status).toBe(200)
  return ((await response.json()) as { result: unknown }).result
}

describe('native Portal and one disabled opt-in runner audience on real D1', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  beforeAll(async () => {
    const binding = await runtime.getD1Database('DB')
    const sql = readFileSync(new URL('../drizzle/0005_mcp_oauth.sql', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
    await binding.batch(sql.map((part) => binding.prepare(part)))
    holder.db = drizzle(binding)
  })
  afterAll(() => runtime.dispose())
  beforeEach(async () => {
    eligible = true
    nativeAuthorize.mockReset().mockReturnValue(undefined)
    defineMcpOAuthPolicy({
      authorize: nativeAuthorize,
      attribution: ({ clientName, user }) => `${clientName} (oauth) for ${user.email}`,
    })
    testClient = await register()
    registerRunner()
  })
  afterEach(() => vi.restoreAllMocks())

  it('defaults remain native and no runner audience exists without explicit registration', async () => {
    const local = createMcpOAuth({ db: holder.db!, config: nativeConfig() })
    expect(local.runnerBridge).toBeUndefined()
    expect(local.runnerConfig).toBeUndefined()
    expect(local.config.refreshTokenTtl).toBe(180 * 86400)
    expect(local.config.refreshTokenIdleTtl).toBe(30 * 86400)
    await expect(
      local
        .api()
        .parseAuthRequest(
          new Request(
            `${ISSUER}/oauth/authorize${(await authorizeQuery(testClient, { resource: RESOURCE })).query}`,
          ),
        ),
    ).rejects.toThrow()
  })
  it('rejects coexistence on arbitrary issuers/resources or overlapping native scopes', () => {
    for (const config of [
      resolveMcpOAuthConfig({ enabled: true }, 'https://other.example')!,
      resolveMcpOAuthConfig({ enabled: true, resourceUri: RESOURCE }, ISSUER)!,
      resolveMcpOAuthConfig({ enabled: true, scopes: RUNNER_SCOPES }, ISSUER)!,
    ]) {
      expect(() =>
        createMcpOAuth({
          db: holder.db!,
          config,
          runnerAudience: { subject: 'owner', clientId: testClient, eligible: async () => true },
        }),
      ).toThrow()
    }
  })
  it('retains native metadata and advertises a union only on the authorization server', async () => {
    const prm = await call('/.well-known/oauth-protected-resource/mcp')
    expect(await prm.json()).toMatchObject({ resource: `${ISSUER}/mcp`, scopes_supported: [SCOPE] })
    const as = await call('/.well-known/oauth-authorization-server')
    expect(await as.json()).toMatchObject({
      issuer: ISSUER,
      scopes_supported: [SCOPE, ...RUNNER_SCOPES],
    })
  })
  it('issues both resources and rejects the other audience in both directions', async () => {
    const native = await connectResource(`${ISSUER}/mcp`)
    const runner = await connectResource()
    expect((await mcp(`Bearer ${native.access_token}`)).status).toBe(200)
    expect(await (await mcp(`Bearer ${native.access_token}`)).json()).toMatchObject({
      via: 'oauth',
      attribution: 'Synthetic ChatGPT (oauth) for owner@family.example',
      scopes: [SCOPE],
    })
    expect(await verifyBridge(native.access_token)).toBeNull()
    expect((await mcp(`Bearer ${runner.access_token}`)).status).toBe(401)
    expect(await verifyBridge(runner.access_token)).toMatchObject({
      resource: RESOURCE,
      scopes: RUNNER_SCOPES,
    })
    expect(await inspector().validate(runner.access_token)).toBeNull()
    expect(await verifyBridge(runner.access_token, `${ISSUER}/mcp`)).toBeNull()
    expect(native.expires_in).toBe(3600)
    expect(runner.expires_in).toBe(3600)
  })
  it('dispatches native consent unchanged and runner policy independently in either registration order', async () => {
    registerRunner()
    defineMcpOAuthPolicy({ authorize: nativeAuthorize })
    await connectResource(`${ISSUER}/mcp`)
    expect(nativeAuthorize).toHaveBeenCalledTimes(2)
    await connectResource()
    expect(nativeAuthorize).toHaveBeenCalledTimes(2)
    nativeAuthorize.mockReturnValue('native refusal')
    const nativeQuery = await authorizeQuery(testClient)
    expect((await openConsent(nativeQuery.query)).body).toMatchObject({
      status: 'error',
      message: 'native refusal',
    })
    registerRunner()
    await connectResource()
    expect(nativeAuthorize).toHaveBeenCalledTimes(3)
  })
  it('rejects cross-audience or mixed scopes, unknown/multiple resources, before consent/grant writes', async () => {
    for (const overrides of [
      { resource: RESOURCE, scope: SCOPE },
      { resource: RESOURCE, scope: `${SCOPE} ${RUNNER_SCOPES[0]}` },
      { scope: RUNNER_SCOPES[0]! },
      { resource: 'https://unknown.example/mcp' },
    ]) {
      const { query } = await authorizeQuery(testClient, overrides)
      const response = await openConsent(query)
      expect(response.body.status).toBe('error')
      expect(response.body.handle).toBeUndefined()
    }
    const { query } = await authorizeQuery(testClient)
    expect(
      (await openConsent(`${query}&resource=${encodeURIComponent(RESOURCE)}`)).body.status,
    ).toBe('error')
    expect(
      (await inspector().api().listUserGrants('owner')).items.filter(
        (g) => g.clientId === testClient,
      ),
    ).toHaveLength(0)
  })
  it('requires exact current runner owner/client and rechecks eligibility on approval', async () => {
    const wrongClient = await register()
    const wrong = await authorizeQuery(wrongClient, {
      resource: RESOURCE,
      scope: RUNNER_SCOPES.join(' '),
    })
    expect((await openConsent(wrong.query)).body.status).toBe('error')
    const { query } = await authorizeQuery(testClient, {
      resource: RESOURCE,
      scope: RUNNER_SCOPES.join(' '),
    })
    const other = await call(`/api/auth/mcp/consent${query}`, {
      headers: { 'x-test-user': 'other' },
    })
    expect(await other.json()).toMatchObject({ status: 'error' })
    const consent = await openConsent(query)
    expect(consent.body.status).toBe('consent')
    eligible = false
    expect((await decide(String(consent.body.handle), consent.cookie, 'approve')).status).toBe(403)
    expect((await openConsent(query)).body.status).toBe('error')
    // Native authorization keeps its own existing policy even during runner refusal.
    await connectResource(`${ISSUER}/mcp`)
  })
  it('omitted resource and scopes select the native audience and native defaults', async () => {
    const native = await connectResource(`${ISSUER}/mcp`, true)
    expect((await mcp(`Bearer ${native.access_token}`)).status).toBe(200)
    expect(await verifyBridge(native.access_token)).toBeNull()
    const { query } = await authorizeQuery(testClient, { resource: null, scope: null })
    expect((await openConsent(query)).body).toMatchObject({
      resource: `${ISSUER}/mcp`,
      scopes: [SCOPE],
    })
  })
  it('pre-resource grant and token records remain bound to native Portal including refresh', async () => {
    const native = await connectResource(`${ISSUER}/mcp`)
    const provider = inspector()
    const summary = (await provider.api().unwrapToken(native.access_token))!
    for (const key of [
      `grant:owner:${summary.grantId}`,
      `token:owner:${summary.grantId}:${summary.id}`,
    ]) {
      const row = (await provider.kv.get(key, 'json')) as Record<string, unknown>
      delete row.resource
      await provider.kv.put(key, JSON.stringify(row), { expirationTtl: 86400 })
    }
    expect((await mcp(`Bearer ${native.access_token}`)).status).toBe(200)
    expect(await verifyBridge(native.access_token)).toBeNull()
    const wrong = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: native.refresh_token,
      resource: RESOURCE,
    })
    expect(wrong.status).toBe(400)
    const refresh = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: native.refresh_token,
    })
    expect(refresh.status).toBe(200)
    const token = (await refresh.json()) as { access_token: string }
    expect((await mcp(`Bearer ${token.access_token}`)).status).toBe(200)
    expect(await verifyBridge(token.access_token)).toBeNull()
  })
  it('refresh cannot retarget either audience or enlarge scopes and preserves the other grant', async () => {
    const native = await connectResource(`${ISSUER}/mcp`),
      runner = await connectResource()
    for (const [token, resource] of [
      [native, RESOURCE],
      [runner, `${ISSUER}/mcp`],
    ] as const) {
      expect(
        (
          await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token,
            resource,
          })
        ).status,
      ).toBe(400)
    }
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: runner.refresh_token,
          resource: RESOURCE,
          scope: SCOPE,
        })
      ).status,
    ).toBe(400)
    for (const [token, resource] of [
      [native, `${ISSUER}/mcp`],
      [runner, RESOURCE],
    ] as const) {
      const refreshed = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        resource,
      })
      expect(refreshed.status).toBe(200)
      expect(
        ((await refreshed.json()) as { access_token: string }).access_token.split(':')[1],
      ).toBe(token.access_token.split(':')[1])
    }
  })
  it('reauthorization and revocation are independent between resources', async () => {
    const native = await connectResource(`${ISSUER}/mcp`),
      runner = await connectResource()
    await connectResource(`${ISSUER}/mcp`)
    expect((await mcp(`Bearer ${native.access_token}`)).status).toBe(401)
    expect(await verifyBridge(runner.access_token)).not.toBeNull()
    const replacement = await connectResource(`${ISSUER}/mcp`)
    await inspector().api().revokeGrant(runner.access_token.split(':')[1]!, 'owner')
    expect(await verifyBridge(runner.access_token)).toBeNull()
    expect((await mcp(`Bearer ${replacement.access_token}`)).status).toBe(200)
    const runnerAgain = await connectResource()
    await inspector().api().revokeGrant(replacement.access_token.split(':')[1]!, 'owner')
    expect(await verifyBridge(runnerAgain.access_token)).not.toBeNull()
  })
  it('runner eligibility/idle expiry close only runner exchanges and signed bridge', async () => {
    const native = await connectResource(`${ISSUER}/mcp`),
      runner = await connectResource()
    eligible = false
    expect(await verifyBridge(runner.access_token)).toBeNull()
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: runner.refresh_token,
          resource: RESOURCE,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: native.refresh_token,
          resource: `${ISSUER}/mcp`,
        })
      ).status,
    ).toBe(200)
    eligible = true
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86401000)
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: runner.refresh_token,
          resource: RESOURCE,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: native.refresh_token,
          resource: `${ISSUER}/mcp`,
        })
      ).status,
    ).toBe(200)
  })
  it('SDK rejects bad token resources before code consumption; native route claim semantics stay unchanged', async () => {
    const { verifier, query } = await authorizeQuery(testClient, {
      resource: RESOURCE,
      scope: RUNNER_SCOPES.join(' '),
    })
    const consent = await openConsent(query)
    const approved = await decide(String(consent.body.handle), consent.cookie, 'approve')
    const code = new URL(
      ((await approved.json()) as { redirectTo: string }).redirectTo,
    ).searchParams.get('code')!
    const sdkToken = (values: Record<string, string>) =>
      inspector().fetch(
        new Request(`${ISSUER}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: testClient, ...values }),
        }),
      )
    const values = {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
    }
    expect((await sdkToken({ ...values, resource: 'https://unknown.example/mcp' })).status).toBe(
      400,
    )
    const multiple = new URLSearchParams({ client_id: testClient, ...values, resource: RESOURCE })
    multiple.append('resource', `${ISSUER}/mcp`)
    expect(
      (
        await inspector().fetch(
          new Request(`${ISSUER}/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: multiple,
          }),
        )
      ).status,
    ).toBe(400)
    expect((await sdkToken({ ...values, resource: RESOURCE })).status).toBe(200)
  })
  it('repeated runner refreshes stop at original seven days while native lifetime remains unchanged', async () => {
    const native = await connectResource(`${ISSUER}/mcp`),
      runner = await connectResource()
    const start = Date.now()
    let now = start,
      refresh = runner.refresh_token
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    for (let step = 1; step <= 13; step++) {
      now = start + step * 12 * 3600000
      const response = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        resource: RESOURCE,
      })
      expect(response.status).toBe(200)
      refresh = ((await response.json()) as { refresh_token: string }).refresh_token
    }
    now = start + 7 * 86400000 + 1000
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          resource: RESOURCE,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: native.refresh_token,
          resource: `${ISSUER}/mcp`,
        })
      ).status,
    ).toBe(200)
  })

  // Explicit cross-repository local proof; normal package CI still exercises the
  // actual OAuth library, D1, bridge auth and DTOs above. No installed service used.
  it.runIf(Boolean(process.env.RUNNERS_MCP_TEST_SOURCE))(
    'dual-audience issuer-to-runner signed lifecycle, refresh, restart and revocation',
    async () => {
      const clientId = testClient
      const runnerRoot = process.env.RUNNERS_MCP_TEST_SOURCE!
      const { McpOAuthBoundary } = await import(
        pathToFileURL(join(runnerRoot, 'lib/mcp-oauth.mjs')).href
      )
      const { createPortalOAuthProvider } = await import(
        pathToFileURL(join(runnerRoot, 'lib/portal-oauth-provider.mjs')).href
      )
      const { MCPEvents, EVENT_NAME } = await import(
        pathToFileURL(join(runnerRoot, 'lib/mcp-events.mjs')).href
      )
      const token = await connectResource()
      const provider = createPortalOAuthProvider({
        secret: SECRET,
        post: async (url: string, body: string, headers: Record<string, string>) => {
          const response = await inspector().runnerBridge!(
            new Request(url, { method: 'POST', headers, body }),
            SECRET,
          )
          return { status: response.status, body: await response.text() }
        },
      })
      const policy = {
        issuer: ISSUER,
        resource: RESOURCE,
        subject: SUBJECT,
        clientId,
        tuples: [ARGS],
      }
      const boundary = new McpOAuthBoundary({ provider, policy })
      const access = await boundary.authenticate(`Bearer ${token.access_token}`)
      const directory = await mkdtemp(join(tmpdir(), 'actual-runner-provider-'))
      let receipts = 0
      const callbackSecret = `whsec_${Buffer.alloc(32, 21).toString('base64')}`
      const make = () =>
        new MCPEvents({
          directory,
          deliveryEnabled: true,
          authorize: (principal: string, args: Record<string, unknown>, purpose: string) =>
            boundary.allowed(principal, args, purpose),
          authorizeQuiet: (principal: string, args: Record<string, unknown>) =>
            boundary.quietAllowed(principal, args),
          subscriptionDeadline: (principal: string) => boundary.subscriptionDeadline(principal),
          post: async (_url: string, body: string, headers: Record<string, string>) => {
            const expected = `v1,${createHmac('sha256', Buffer.alloc(32, 21)).update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`).digest('base64')}`
            expect(headers['webhook-signature']).toBe(expected)
            const parsed = JSON.parse(body)
            if (parsed.type === 'verification')
              return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) }
            receipts++
            return { status: 204, body: '' }
          },
        })
      let service = make()
      try {
        await service.restore()
        const params = {
          name: EVENT_NAME,
          arguments: { ...ARGS, kind: 'violation_opened', severity: 'P1' },
          delivery: {
            mode: 'webhook',
            url: 'https://callback.example.com/events',
            secret: callbackSecret,
          },
        }
        await service.subscribe(access.principal, params)
        const row = {
          ...ARGS,
          recordedAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          sequence: 1,
          kind: 'violation_opened',
          severity: 'P1',
          detail: 'Synthetic expected runner missing',
        }
        await service.ingest([row])
        await service.pump()
        expect(receipts).toBe(1)
        await service.ingest([row])
        await service.pump()
        expect(receipts).toBe(1)
        const refreshed = await tokenRequest({
          resource: RESOURCE,
          grant_type: 'refresh_token',
          refresh_token: token.refresh_token,
        })
        const second = (await refreshed.json()) as { access_token: string }
        expect((await boundary.authenticate(`Bearer ${second.access_token}`)).principal).toBe(
          access.principal,
        )
        service.close()
        service = make()
        await service.restore()
        await service.ingest([{ ...row, sequence: 2 }])
        await service.pump()
        expect(receipts).toBe(2)
        await inspector().api().revokeGrant(token.access_token.split(':')[1]!, SUBJECT)
        await service.ingest([{ ...row, sequence: 3 }])
        await service.pump()
        expect(receipts).toBe(2)
        expect(service.state.subscriptions[0].status).toBe('revoked')
      } finally {
        service.close()
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
