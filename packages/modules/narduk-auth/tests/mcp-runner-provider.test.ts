import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createMcpOAuth, resolveMcpOAuthConfig } from '../server/lib/mcp-oauth/core'
import { RUNNER_BRIDGE_PATH, RUNNER_SCOPES } from '../server/lib/mcp-oauth/runner-provider'

import type { McpOAuth } from '../server/lib/mcp-oauth/core'

const ISSUER = 'https://ops.nardukenterprises.com'
const RESOURCE = 'https://runner-hooks.nard.uk/mcp'
const CALLBACK = 'https://chat.example.com/oauth/callback'
const SUBJECT = 'synthetic-owner'
const KEY = Buffer.alloc(32, 29)
const SECRET = `whsec_${KEY.toString('base64')}`
const ARGS = {
  source: 'liveness',
  code: 'PERSISTENT_RUNNER_MISSING',
  target: 'narduk-enterprises/linux-deploy/github-deploy-runner-1',
}
let clientId: string
let eligible = true
let outage = false
let mcp: McpOAuth
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
})

function signed(body: string, options: { id?: string; key?: Buffer; timestamp?: number } = {}) {
  const id = options.id ?? randomUUID()
  const stamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  return new Request(`${ISSUER}${RUNNER_BRIDGE_PATH}`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': stamp,
      'webhook-signature': `v1,${createHmac('sha256', options.key ?? KEY)
        .update(`${id}.${stamp}.${body}`)
        .digest('base64')}`,
    },
  })
}
async function bridge(method: string, input: Record<string, unknown>) {
  const response = await mcp.runnerBridge!(signed(JSON.stringify({ method, input })), SECRET)
  expect(response.status).toBe(200)
  return ((await response.json()) as { result: Record<string, unknown> | null }).result
}
async function authorize(extra: Record<string, string> = {}) {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url')
  const request = await mcp.api().parseAuthRequest(
    new Request(
      `${ISSUER}/oauth/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: RESOURCE,
        scope: RUNNER_SCOPES.join(' '),
        ...extra,
      })}`,
    ),
  )
  const authorization = await mcp.api().completeAuthorization({
    request,
    userId: SUBJECT,
    scope: request.scope,
    metadata: { clientName: 'Synthetic ChatGPT' },
    props: { userId: SUBJECT, clientId, clientName: 'Synthetic ChatGPT' },
  })
  return { code: new URL(authorization.redirectTo).searchParams.get('code')!, verifier }
}
async function exchange(values: Record<string, string>) {
  return mcp.fetch(
    new Request(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, resource: RESOURCE, ...values }),
    }),
  )
}
async function tokens() {
  const auth = await authorize()
  const response = await exchange({
    grant_type: 'authorization_code',
    code: auth.code,
    redirect_uri: CALLBACK,
    code_verifier: auth.verifier,
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { access_token: string; refresh_token: string }
}
const ref = (grantId: string) => ({
  issuer: ISSUER,
  resource: RESOURCE,
  subject: SUBJECT,
  clientId,
  grantId,
})

beforeAll(async () => {
  const binding = await runtime.getD1Database('DB')
  const statements = readFileSync(new URL('../drizzle/0005_mcp_oauth.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
  await binding.batch(statements.map((statement) => binding.prepare(statement)))
  const db = drizzle(binding)
  // A separately registered public synthetic client, never a production grant.
  const local = createMcpOAuth({ db, config: resolveMcpOAuthConfig({ enabled: true }, ISSUER)! })
  const registered = await local.fetch(
    new Request(`${ISSUER}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Synthetic ChatGPT',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }),
  )
  clientId = ((await registered.json()) as { client_id: string }).client_id
  mcp = createMcpOAuth({
    db,
    config: resolveMcpOAuthConfig(
      {
        enabled: true,
        resourceUri: RESOURCE,
        scopes: [...RUNNER_SCOPES],
        requiredScopes: [RUNNER_SCOPES[0]],
        accessTokenTtl: 3600,
        refreshTokenTtl: 604800,
        refreshTokenIdleTtl: 86400,
      },
      ISSUER,
    )!,
    runner: {
      subject: SUBJECT,
      clientId,
      async eligible() {
        if (outage) throw new Error('synthetic outage')
        return eligible
      },
    },
  })
})
afterAll(() => runtime.dispose())
afterEach(() => {
  eligible = true
  outage = false
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('external runner provider on real local D1 and opaque OAuth library', () => {
  it('preserves local defaults and strictly checks external resource/policy limits', () => {
    expect(resolveMcpOAuthConfig({}, ISSUER)).toBeNull()
    expect(resolveMcpOAuthConfig({ enabled: true }, ISSUER)?.resource).toBe(`${ISSUER}/mcp`)
    for (const resourceUri of [
      'http://evil.example/mcp',
      'https://evil.example/mcp?x=1',
      'https://evil.example/other',
      'https://u@evil.example/mcp',
      'https://localhost/mcp',
      'https://evil.example:8443/mcp',
    ]) {
      expect(() => resolveMcpOAuthConfig({ enabled: true, resourceUri }, ISSUER)).toThrow()
    }
  })
  it('uses actual PKCE exchange, validates opaque token and exports only sanitized milliseconds DTOs', async () => {
    const token = await tokens()
    const validated = await bridge('verifyAccessToken', {
      issuer: ISSUER,
      resource: RESOURCE,
      token: token.access_token,
    })
    expect(validated).toMatchObject({
      issuer: ISSUER,
      resource: RESOURCE,
      subject: SUBJECT,
      clientId,
      scopes: [...RUNNER_SCOPES],
    })
    expect(Number(validated!.expiresAt) - Number(validated!.issuedAt)).toBeLessThanOrEqual(3600000)
    const grant = await bridge('readGrant', ref(validated!.grantId as string))
    expect(grant).toMatchObject({ active: true, ownerEligible: true, subject: SUBJECT, clientId })
    expect(Object.keys(grant!).sort()).toEqual([
      'active',
      'clientId',
      'createdAt',
      'expiresAt',
      'grantId',
      'issuer',
      'lastActiveAt',
      'ownerEligible',
      'resource',
      'scopes',
      'subject',
    ])
    expect(Number(grant!.createdAt)).toBeGreaterThan(1700000000000)
    expect(
      await bridge('verifyAccessToken', {
        issuer: ISSUER,
        resource: `${ISSUER}/mcp`,
        token: token.access_token,
      }),
    ).toBeNull()
    expect(
      await bridge('verifyAccessToken', {
        issuer: ISSUER,
        resource: RESOURCE,
        token: token.access_token + 'x',
      }),
    ).toBeNull()
  })
  it('honors configured lifetimes shorter than the maximum runner caps', async () => {
    const previousAccess = mcp.config.accessTokenTtl
    const previousIdle = mcp.config.refreshTokenIdleTtl
    mcp.config.accessTokenTtl = 600
    mcp.config.refreshTokenIdleTtl = 1200
    try {
      const token = await tokens()
      const validated = await bridge('verifyAccessToken', {
        issuer: ISSUER,
        resource: RESOURCE,
        token: token.access_token,
      })
      expect(Number(validated!.expiresAt) - Number(validated!.issuedAt)).toBe(600000)
      const grant = await bridge('readGrant', ref(validated!.grantId as string))
      expect(Number(grant!.expiresAt) - Number(grant!.lastActiveAt)).toBe(1200000)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 1200001)
      const refreshed = await exchange({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
      })
      expect(refreshed.status).toBe(400)
    } finally {
      mcp.config.accessTokenTtl = previousAccess
      mcp.config.refreshTokenIdleTtl = previousIdle
    }
  })
  it('refuses invalid PKCE, owner/client/audience and withheld owner eligibility at exchange', async () => {
    const auth = await authorize()
    expect(
      (
        await exchange({
          grant_type: 'authorization_code',
          code: auth.code,
          redirect_uri: CALLBACK,
          code_verifier: 'bad',
        })
      ).status,
    ).toBe(400)
    eligible = false
    const next = await authorize()
    expect(
      (
        await exchange({
          grant_type: 'authorization_code',
          code: next.code,
          redirect_uri: CALLBACK,
          code_verifier: next.verifier,
        })
      ).status,
    ).toBe(400)
    expect(await bridge('readGrant', { ...ref('unknown'), subject: 'another-owner' })).toEqual({
      active: false,
    })
    expect(await bridge('readGrant', { ...ref('unknown'), clientId: 'another-client' })).toEqual({
      active: false,
    })
    await expect(authorize({ resource: `${ISSUER}/mcp` })).rejects.toThrow()
  })
  it('rejects unsigned, bad-key, stale, duplicate, malformed and oversized bridge requests', async () => {
    const body = JSON.stringify({ method: 'readGrant', input: ref('unknown') })
    const request = signed(body)
    expect((await mcp.runnerBridge!(request.clone(), '')).status).toBe(404)
    expect(
      (await mcp.runnerBridge!(new Request(request.url, { method: 'POST', body }), SECRET)).status,
    ).toBe(401)
    expect(
      (await mcp.runnerBridge!(signed(body, { key: Buffer.alloc(32, 2) }), SECRET)).status,
    ).toBe(401)
    expect(
      (
        await mcp.runnerBridge!(
          signed(body, { timestamp: Math.floor(Date.now() / 1000) - 31 }),
          SECRET,
        )
      ).status,
    ).toBe(401)
    expect((await mcp.runnerBridge!(request.clone(), SECRET)).status).toBe(200)
    expect((await mcp.runnerBridge!(request.clone(), SECRET)).status).toBe(401)
    expect((await mcp.runnerBridge!(signed('{}'), SECRET)).status).toBe(400)
    expect((await mcp.runnerBridge!(signed('x'.repeat(8193)), SECRET)).status).toBe(413)
    expect(
      (await mcp.runnerBridge!(new Request(request.url + '?x=1', request.clone()), SECRET)).status,
    ).toBe(404)
  })
  it('holds unknown authority, refuses eligibility withdrawal and reads actual revocation without extending activity', async () => {
    const token = await tokens()
    const grantId = token.access_token.split(':')[1]!
    const before = await bridge('readGrant', ref(grantId))
    expect(await bridge('readGrant', ref(grantId))).toEqual(before)
    outage = true
    expect(
      (
        await mcp.runnerBridge!(
          signed(JSON.stringify({ method: 'readGrant', input: ref(grantId) })),
          SECRET,
        )
      ).status,
    ).toBe(503)
    outage = false
    eligible = false
    expect(
      await bridge('verifyAccessToken', {
        issuer: ISSUER,
        resource: RESOURCE,
        token: token.access_token,
      }),
    ).toBeNull()
    expect(await bridge('readGrant', ref(grantId))).toMatchObject({ ownerEligible: false })
    eligible = true
    await mcp.api().revokeGrant(grantId, SUBJECT)
    expect(await bridge('readGrant', ref(grantId))).toMatchObject({ active: false })
  })
  it('refresh preserves the grant, never reseeds missing activity, and enforces one-day idle / fixed seven-day cap', async () => {
    const token = await tokens()
    const grantId = token.access_token.split(':')[1]!
    const prior = await bridge('readGrant', ref(grantId))
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    })
    expect(refreshed.status).toBe(200)
    const refreshedToken = (await refreshed.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(refreshedToken.access_token.split(':')[1]).toBe(grantId)
    expect((await bridge('readGrant', ref(grantId)))!.createdAt).toBe(prior!.createdAt)
    await mcp.kv.delete(`narduk-runner-activity:${SUBJECT}:${grantId}`)
    expect(
      (await exchange({ grant_type: 'refresh_token', refresh_token: refreshedToken.refresh_token }))
        .status,
    ).toBe(400)
    const idle = await tokens()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86401000)
    expect(
      (await exchange({ grant_type: 'refresh_token', refresh_token: idle.refresh_token })).status,
    ).toBe(400)
  })
  it('repeated valid refreshes stop at the original seven-day lifetime', async () => {
    const original = await tokens()
    const grantId = original.access_token.split(':')[1]!
    const start = Date.now()
    let now = start
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let refresh = original.refresh_token
    for (let step = 1; step <= 13; step++) {
      now = start + step * 12 * 3600000
      const response = await exchange({ grant_type: 'refresh_token', refresh_token: refresh })
      expect(response.status).toBe(200)
      refresh = ((await response.json()) as { refresh_token: string }).refresh_token
      const grant = await bridge('readGrant', ref(grantId))
      expect(Number(grant!.expiresAt)).toBeLessThanOrEqual(start + 7 * 86400000)
    }
    now = start + 7 * 86400000 + 1000
    expect((await exchange({ grant_type: 'refresh_token', refresh_token: refresh })).status).toBe(
      400,
    )
  })
  it('purges expired replay markers using the existing expiry-index cleanup', async () => {
    await mcp.kv.put('narduk-runner-bridge:expired-synthetic-nonce', '1', {
      expiration: Math.floor(Date.now() / 1000) - 1,
    })
    await bridge('readGrant', ref('unknown'))
    expect(await mcp.kv.claimOnce('narduk-runner-bridge:expired-synthetic-nonce', 120)).toBe(true)
  })
})

// Explicit cross-repository local proof; normal package CI still exercises the
// actual OAuth library, D1, bridge auth and DTOs above. No installed service used.
it.runIf(Boolean(process.env.RUNNERS_MCP_TEST_SOURCE))(
  'provider-to-runner signed lifecycle, refresh, restart and revocation',
  async () => {
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
    const token = await tokens()
    const provider = createPortalOAuthProvider({
      secret: SECRET,
      post: async (url: string, body: string, headers: Record<string, string>) => {
        const response = await mcp.runnerBridge!(
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
      const refreshed = await exchange({
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
      await mcp.api().revokeGrant(token.access_token.split(':')[1]!, SUBJECT)
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
