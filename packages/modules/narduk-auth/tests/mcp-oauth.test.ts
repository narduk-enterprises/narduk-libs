import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createMcpOAuth, resolveMcpOAuthConfig } from '../server/lib/mcp-oauth/core'

import type { McpOAuth } from '../server/lib/mcp-oauth/core'

const ISSUER = 'https://family.example'
const RESOURCE = `${ISSUER}/mcp`
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const READ = 'family:read'
const WRITE = 'family:write'

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(new Uint8Array(digest)) }
}

function form(values: Record<string, string>): Request {
  return new Request(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  })
}

describe('MCP OAuth authorization server on D1', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let mcp: McpOAuth

  beforeAll(async () => {
    const binding = await runtime.getD1Database('DB')
    const migration = readFileSync(
      new URL('../drizzle/0005_mcp_oauth.sql', import.meta.url),
      'utf8',
    )
    const statements = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
    await binding.batch(statements.map((item) => binding.prepare(item)))
    const config = resolveMcpOAuthConfig(
      {
        enabled: true,
        resourceName: 'Family',
        scopes: [READ, WRITE],
        requiredScopes: [READ, WRITE],
      },
      `${ISSUER}/some/page`,
    )
    mcp = createMcpOAuth({ db: drizzle(binding), config: config! })
  })
  afterAll(() => runtime.dispose())
  afterEach(() => vi.useRealTimers())

  async function register(redirectUris = [CLAUDE_CALLBACK], name = 'Claude') {
    return mcp.fetch(
      new Request(`${ISSUER}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: name,
          redirect_uris: redirectUris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      }),
    )
  }

  async function registeredClient(): Promise<string> {
    const response = await register()
    expect(response.status).toBe(201)
    return ((await response.json()) as { client_id: string }).client_id
  }

  function authorizeUrl(params: Record<string, string>): string {
    return `${ISSUER}/oauth/authorize?${new URLSearchParams(params)}`
  }

  /** register → authorize (consent approved for `owner`) → code. */
  async function authorize(options: { resource?: string } = {}) {
    const clientId = await registeredClient()
    const { verifier, challenge } = await pkce()
    const api = mcp.api()
    const request = await api.parseAuthRequest(
      new Request(
        authorizeUrl({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: CLAUDE_CALLBACK,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'state-123',
          scope: `${READ} ${WRITE}`,
          resource: options.resource ?? RESOURCE,
        }),
      ),
    )
    const { redirectTo } = await api.completeAuthorization({
      request,
      userId: 'owner',
      metadata: { clientName: 'Claude' },
      scope: request.scope,
      props: { userId: 'owner', clientId, clientName: 'Claude' },
    })
    const redirect = new URL(redirectTo)
    expect(redirect.origin + redirect.pathname).toBe(CLAUDE_CALLBACK)
    expect(redirect.searchParams.get('state')).toBe('state-123')
    expect(redirect.searchParams.get('iss')).toBe(ISSUER)
    return { clientId, verifier, code: redirect.searchParams.get('code')! }
  }

  async function exchange(input: { clientId: string; code: string; verifier: string }) {
    return mcp.fetch(
      form({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: CLAUDE_CALLBACK,
        client_id: input.clientId,
        code_verifier: input.verifier,
        resource: RESOURCE,
      }),
    )
  }

  async function tokens() {
    const auth = await authorize()
    const response = await exchange(auth)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      access_token: string
      expires_in: number
      refresh_token: string
      scope: string
      token_type: string
    }
    return { ...auth, ...body }
  }

  describe('metadata documents', () => {
    it('publishes RFC 8414 authorization server metadata an MCP client needs', async () => {
      const response = await mcp.fetch(
        new Request(`${ISSUER}/.well-known/oauth-authorization-server`),
      )
      expect(response.status).toBe(200)
      const metadata = (await response.json()) as Record<string, unknown>
      expect(metadata).toMatchObject({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        registration_endpoint: `${ISSUER}/oauth/register`,
        revocation_endpoint: `${ISSUER}/oauth/token`,
        code_challenge_methods_supported: ['S256'],
        response_types_supported: ['code'],
        authorization_response_iss_parameter_supported: true,
        scopes_supported: [READ, WRITE],
      })
      expect(metadata.token_endpoint_auth_methods_supported).toContain('none')
      expect(metadata.grant_types_supported).toEqual(
        expect.arrayContaining(['authorization_code', 'refresh_token']),
      )
    })

    it('publishes RFC 9728 protected resource metadata for the MCP endpoint', () => {
      expect(mcp.protectedResourceMetadata()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: [READ, WRITE],
        bearer_methods_supported: ['header'],
        resource_name: 'Family',
      })
      expect(mcp.config.resourceMetadataUrl).toBe(
        `${ISSUER}/.well-known/oauth-protected-resource/mcp`,
      )
    })

    it('builds the 401 challenge that points at the resource metadata', () => {
      expect(mcp.challenge()).toBe(
        `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="family:read family:write"`,
      )
      expect(mcp.challenge({ error: 'invalid_token', description: 'Token "expired"' })).toContain(
        'error="invalid_token", error_description="Token expired"',
      )
    })

    it('refuses a non-https issuer unless it is loopback', () => {
      expect(() => resolveMcpOAuthConfig({ enabled: true }, 'http://family.example')).toThrow(
        /https/u,
      )
      expect(resolveMcpOAuthConfig({ enabled: true }, 'http://127.0.0.1:3000')?.resource).toBe(
        'http://127.0.0.1:3000/mcp',
      )
      expect(resolveMcpOAuthConfig({ enabled: false }, ISSUER)).toBeNull()
    })
  })

  describe('dynamic client registration', () => {
    it('registers a public client with an https redirect URI', async () => {
      const response = await register()
      expect(response.status).toBe(201)
      const client = (await response.json()) as Record<string, unknown>
      expect(client.client_id).toEqual(expect.any(String))
      expect(client.client_secret).toBeUndefined()
      expect(client.token_endpoint_auth_method).toBe('none')
      expect(client.redirect_uris).toEqual([CLAUDE_CALLBACK])
    })

    it('accepts a loopback redirect for a native client', async () => {
      expect((await register(['http://127.0.0.1:33418/callback'], 'Local')).status).toBe(201)
    })

    it('refuses remote http and script redirect URIs', async () => {
      expect((await register(['http://evil.example/callback'])).status).toBe(400)
      expect((await register(['javascript:alert(1)'])).status).toBe(400)
    })
  })

  describe('authorization code with PKCE', () => {
    it('refuses an authorization request without a code challenge', async () => {
      const clientId = await registeredClient()
      await expect(
        mcp.api().parseAuthRequest(
          new Request(
            authorizeUrl({
              response_type: 'code',
              client_id: clientId,
              redirect_uri: CLAUDE_CALLBACK,
              state: 's',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' })
    })

    it('refuses the plain PKCE method', async () => {
      const clientId = await registeredClient()
      await expect(
        mcp.api().parseAuthRequest(
          new Request(
            authorizeUrl({
              response_type: 'code',
              client_id: clientId,
              redirect_uri: CLAUDE_CALLBACK,
              code_challenge: 'a'.repeat(43),
              code_challenge_method: 'plain',
              state: 's',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' })
    })

    it('refuses a redirect URI that is not an exact registered match, without redirecting', async () => {
      const clientId = await registeredClient()
      const { challenge } = await pkce()
      const error = await mcp
        .api()
        .parseAuthRequest(
          new Request(
            authorizeUrl({
              response_type: 'code',
              client_id: clientId,
              redirect_uri: `${CLAUDE_CALLBACK}/extra`,
              code_challenge: challenge,
              code_challenge_method: 'S256',
              state: 's',
            }),
          ),
        )
        .catch((caught: unknown) => caught as { code: string; redirectTo?: string })
      expect(error.code).toBe('invalid_request')
      expect(error.redirectTo).toBeUndefined()
    })

    it('refuses a wrong code verifier and burns nothing it should not', async () => {
      const auth = await authorize()
      const wrong = await exchange({ ...auth, verifier: (await pkce()).verifier })
      expect(wrong.status).toBe(400)
      expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant')
    })

    it('exchanges a code once, bound to the resource audience', async () => {
      const issued = await tokens()
      expect(issued.token_type.toLowerCase()).toBe('bearer')
      expect(issued.expires_in).toBe(3600)
      const valid = await mcp.validate(issued.access_token)
      expect(valid).toMatchObject({
        audience: RESOURCE,
        userId: 'owner',
        clientId: issued.clientId,
        props: { userId: 'owner', clientName: 'Claude' },
        scope: [READ, WRITE],
      })
      const replay = await exchange(issued)
      expect(replay.status).toBe(400)
    })
  })

  describe('audience binding', () => {
    it('refuses an authorization request for another resource', async () => {
      await expect(authorize({ resource: 'https://other.example/mcp' })).rejects.toMatchObject({
        code: 'invalid_target',
      })
    })

    it('refuses a token exchange that names another resource', async () => {
      const auth = await authorize()
      const response = await mcp.fetch(
        form({
          grant_type: 'authorization_code',
          code: auth.code,
          redirect_uri: CLAUDE_CALLBACK,
          client_id: auth.clientId,
          code_verifier: auth.verifier,
          resource: 'https://other.example/mcp',
        }),
      )
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toBe('invalid_target')
    })

    it('does not accept a token minted for another resource', async () => {
      const issued = await tokens()
      const other = createMcpOAuth({
        db: drizzle(await runtime.getD1Database('DB')),
        config: resolveMcpOAuthConfig({ enabled: true, resourcePath: '/other' }, ISSUER)!,
      })
      expect(await other.validate(issued.access_token)).toBeNull()
      expect(await mcp.validate(issued.access_token)).not.toBeNull()
    })

    it('rejects malformed and API-key-shaped bearers without a lookup', async () => {
      expect(await mcp.validate('nk_abcdef')).toBeNull()
      expect(await mcp.validate('a::b')).toBeNull()
    })
  })

  describe('token lifecycle', () => {
    it('expires access tokens after the configured lifetime', async () => {
      const issued = await tokens()
      expect(await mcp.validate(issued.access_token)).not.toBeNull()
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 3601 * 1000)
      expect(await mcp.validate(issued.access_token)).toBeNull()
    })

    it('rotates refresh tokens and retires the old one once the new one is used', async () => {
      const issued = await tokens()
      const refresh = (token: string) =>
        mcp.fetch(
          form({
            grant_type: 'refresh_token',
            refresh_token: token,
            client_id: issued.clientId,
            resource: RESOURCE,
          }),
        )
      const first = await refresh(issued.refresh_token)
      expect(first.status).toBe(200)
      const rotated = (await first.json()) as { access_token: string; refresh_token: string }
      expect(rotated.refresh_token).not.toBe(issued.refresh_token)
      expect(await mcp.validate(rotated.access_token)).not.toBeNull()

      const second = await refresh(rotated.refresh_token)
      expect(second.status).toBe(200)
      const stale = await refresh(issued.refresh_token)
      expect(stale.status).toBe(400)
      expect(((await stale.json()) as { error: string }).error).toBe('invalid_grant')
    })

    it('revokes through the RFC 7009 endpoint', async () => {
      const issued = await tokens()
      const response = await mcp.fetch(
        new Request(`${ISSUER}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: issued.refresh_token,
            token_type_hint: 'refresh_token',
            client_id: issued.clientId,
          }),
        }),
      )
      expect(response.status).toBe(200)
      expect(await mcp.validate(issued.access_token)).toBeNull()
    })

    it('lists and revokes a user grant (the connected-apps surface)', async () => {
      const issued = await tokens()
      const valid = await mcp.validate(issued.access_token)
      const grants = await mcp.api().listUserGrants('owner')
      expect(grants.items.some((grant) => grant.id === valid?.grantId)).toBe(true)
      await mcp.api().revokeGrant(valid!.grantId, 'owner')
      expect(await mcp.validate(issued.access_token)).toBeNull()
      const after = await mcp.api().listUserGrants('owner')
      expect(after.items.some((grant) => grant.id === valid?.grantId)).toBe(false)
    })

    it('stores no raw token, code or secret', async () => {
      const issued = await tokens()
      const binding = await runtime.getD1Database('DB')
      const { results } = await binding.prepare('SELECT key, value FROM auth_oauth_kv').all()
      const dump = JSON.stringify(results)
      expect(dump).not.toContain(issued.access_token.split(':')[2])
      expect(dump).not.toContain(issued.refresh_token.split(':')[2])
      expect(dump).not.toContain(issued.code.split(':')[2])
    })
  })
})
