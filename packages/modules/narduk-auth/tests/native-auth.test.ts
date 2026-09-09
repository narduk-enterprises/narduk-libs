import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createNativeAuth,
  nativeAuthDigest,
  nativeAuthSecret,
  validateNativeAuthorization,
} from '../server/lib/app-auth/native-core'

const clients = [{ id: 'mac', name: 'Test Mac', redirectUris: ['com.example.test:/auth'] }]
const epoch = 1_800_000_000

describe('native auth public service on D1', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let binding: Awaited<ReturnType<Miniflare['getD1Database']>>
  let auth: ReturnType<typeof createNativeAuth>
  let now = epoch

  beforeAll(async () => {
    binding = await runtime.getD1Database('DB')
    await binding.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run()
    const migration = readFileSync(
      new URL('../drizzle/0004_native_auth.sql', import.meta.url),
      'utf8',
    )
    await binding.batch(
      migration
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => binding.prepare(item)),
    )
    await binding.prepare("INSERT INTO users VALUES ('owner')").run()
    auth = createNativeAuth(drizzle(binding), clients, () => now)
  })
  afterAll(() => runtime.dispose())

  async function request() {
    const codeVerifier = nativeAuthSecret()
    const input = {
      clientId: 'mac',
      redirectUri: clients[0]!.redirectUris[0]!,
      codeChallenge: await nativeAuthDigest(codeVerifier),
      codeChallengeMethod: 'S256' as const,
      state: nativeAuthSecret(),
    }
    const redirect = new URL(await auth.issueCode('owner', input))
    expect(redirect.searchParams.get('state')).toBe(input.state)
    return { ...input, codeVerifier, code: redirect.searchParams.get('code')! }
  }

  it('implements the RFC 7636 S256 reference vector', async () => {
    expect(await nativeAuthDigest('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('requires an exact callback, strong state, and S256 challenge', async () => {
    const input = {
      clientId: 'mac',
      redirectUri: clients[0]!.redirectUris[0]!,
      codeChallenge: await nativeAuthDigest(nativeAuthSecret()),
      codeChallengeMethod: 'S256' as const,
      state: nativeAuthSecret(),
    }
    expect(validateNativeAuthorization(clients, input).id).toBe('mac')
    expect(() =>
      validateNativeAuthorization(clients, { ...input, redirectUri: 'com.example.attacker:/auth' }),
    ).toThrow()
    expect(() => validateNativeAuthorization(clients, { ...input, state: '' })).toThrow()
    expect(() =>
      validateNativeAuthorization(clients, { ...input, codeChallenge: 'short' }),
    ).toThrow()
    expect(() =>
      validateNativeAuthorization(clients, { ...input, codeChallengeMethod: 'plain' as 'S256' }),
    ).toThrow()
  })

  it('rejects wrong PKCE/client/callback without consuming the code', async () => {
    const input = await request()
    await expect(auth.exchange({ ...input, codeVerifier: nativeAuthSecret() })).rejects.toThrow()
    await expect(auth.exchange({ ...input, clientId: 'other' })).rejects.toThrow()
    await expect(
      auth.exchange({ ...input, redirectUri: 'com.example.test:/other' }),
    ).rejects.toThrow()
    const token = await auth.exchange(input)
    expect(await auth.resolve(token.accessToken)).toMatchObject({
      userId: 'owner',
      clientId: 'mac',
    })
  })

  it('admits exactly one concurrent exchange and persists no raw credentials', async () => {
    const input = await request()
    const results = await Promise.allSettled([auth.exchange(input), auth.exchange(input)])
    const winners = results.filter((result) => result.status === 'fulfilled')
    expect(winners).toHaveLength(1)
    const token = winners[0]!.value
    const row = await binding
      .prepare('SELECT * FROM auth_native_sessions WHERE id = ?')
      .bind(token.sessionId)
      .first()
    expect(row?.code_hash).toBeNull()
    expect(JSON.stringify(row)).not.toContain(token.accessToken)
    expect(JSON.stringify(row)).not.toContain(token.refreshToken)
    expect(JSON.stringify(row)).not.toContain(input.code)
    await expect(auth.exchange(input)).rejects.toThrow()
  })

  it('rotates refresh credentials atomically and invalidates the previous access token', async () => {
    const token = await auth.exchange(await request())
    const results = await Promise.allSettled([
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ])
    const winners = results.filter((result) => result.status === 'fulfilled')
    expect(winners).toHaveLength(1)
    expect(await auth.resolve(token.accessToken)).toBeNull()
    expect(await auth.resolve(winners[0]!.value.accessToken)).toMatchObject({
      sessionId: token.sessionId,
    })
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toThrow()
  })

  it('expires codes and access independently and never extends the absolute session lifetime', async () => {
    const input = await request()
    now += 61
    await expect(auth.exchange(input)).rejects.toThrow()
    const token = await auth.exchange(await request())
    now += token.expiresIn + 1
    expect(await auth.resolve(token.accessToken)).toBeNull()
    const refreshed = await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    expect(refreshed.refreshExpiresAt).toBe(token.refreshExpiresAt)
    now = refreshed.refreshExpiresAt
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: refreshed.refreshToken }),
    ).rejects.toThrow()
    now = epoch
  })

  it('revokes an individual session and all user sessions including outstanding codes', async () => {
    const a = await auth.exchange(await request())
    await auth.revoke(a.refreshToken)
    expect(await auth.resolve(a.accessToken)).toBeNull()
    await expect(auth.refresh({ clientId: 'mac', refreshToken: a.refreshToken })).rejects.toThrow()
    const b = await auth.exchange(await request())
    const code = await request()
    await auth.revokeUser('owner')
    expect(await auth.resolve(b.accessToken)).toBeNull()
    await expect(auth.exchange(code)).rejects.toThrow()
  })

  it('does not consume a code when the session update fails', async () => {
    const input = await request()
    await binding
      .prepare(
        "CREATE TRIGGER fail_exchange BEFORE UPDATE ON auth_native_sessions BEGIN SELECT RAISE(ABORT, 'write failure'); END",
      )
      .run()
    await expect(auth.exchange(input)).rejects.toThrow()
    await binding.prepare('DROP TRIGGER fail_exchange').run()
    expect((await auth.exchange(input)).tokenType).toBe('Bearer')
  })

  it('disables existing credentials when a client is removed', async () => {
    const token = await auth.exchange(await request())
    const disabled = createNativeAuth(drizzle(binding), [], () => now)
    expect(await disabled.resolve(token.accessToken)).toBeNull()
    await expect(
      disabled.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toThrow()
  })

  it('cascades account deletion to native credentials', async () => {
    const token = await auth.exchange(await request())
    await binding.prepare("DELETE FROM users WHERE id = 'owner'").run()
    expect(await auth.resolve(token.accessToken)).toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toThrow()
  })
})
