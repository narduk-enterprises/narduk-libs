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
    const migration = ['0004_native_auth.sql', '0007_native_refresh_reuse.sql']
      .map((name) => readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'))
      .join(';')
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

  async function revokedAt(sessionId: string) {
    const row = await binding
      .prepare('SELECT revoked_at FROM auth_native_sessions WHERE id = ?')
      .bind(sessionId)
      .first<{ revoked_at: number | null }>()
    return row?.revoked_at
  }

  it('rotates refresh credentials and invalidates the previous access token', async () => {
    const token = await auth.exchange(await request())
    const refreshed = await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    expect(refreshed.sessionId).toBe(token.sessionId)
    expect(await auth.resolve(token.accessToken)).toBeNull()
    expect(await auth.resolve(refreshed.accessToken)).toMatchObject({
      sessionId: token.sessionId,
    })
    const spent = await binding
      .prepare('SELECT * FROM auth_native_refreshes WHERE session_id = ?')
      .bind(token.sessionId)
      .all()
    expect(spent.results).toEqual([
      {
        refresh_hash: await nativeAuthDigest(token.refreshToken),
        session_id: token.sessionId,
        rotated_at: now,
      },
    ])
    expect(JSON.stringify(spent.results)).not.toContain(token.refreshToken)
  })

  it('ends the session when a rotated refresh token is presented again', async () => {
    const token = await auth.exchange(await request())
    const refreshed = await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(await revokedAt(token.sessionId)).toBe(now)
    expect(await auth.resolve(refreshed.accessToken)).toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: refreshed.refreshToken }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it("ends a thief's session when the app later presents its stale token", async () => {
    // The thief rotates first and twice, so the app's token is two rotations old.
    const token = await auth.issueSession('owner', 'mac', 'passkey')
    const stolen = await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    const thief = await auth.refresh({ clientId: 'mac', refreshToken: stolen.refreshToken })
    expect(await auth.resolve(thief.accessToken)).not.toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(await auth.resolve(thief.accessToken)).toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: thief.refreshToken }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('leaves other sessions of the user alone when one session is reused', async () => {
    const other = await auth.exchange(await request())
    const token = await auth.exchange(await request())
    await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toThrow()
    expect(await auth.resolve(other.accessToken)).toMatchObject({ sessionId: other.sessionId })
  })

  it('ends the session when one refresh token is presented twice at once', async () => {
    const token = await auth.exchange(await request())
    const results = await Promise.allSettled([
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ])
    expect(results.filter((result) => result.status === 'rejected').length).toBeGreaterThan(0)
    expect(await revokedAt(token.sessionId)).toBe(now)
    for (const result of results) {
      if (result.status === 'fulfilled') {
        expect(await auth.resolve(result.value.accessToken)).toBeNull()
      }
    }
  })

  it('does not treat an unknown refresh token as reuse', async () => {
    const token = await auth.exchange(await request())
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: nativeAuthSecret() }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(await revokedAt(token.sessionId)).toBeNull()
    expect(await auth.resolve(token.accessToken)).not.toBeNull()
  })

  it('revokes only the passkey-minted sessions of one user', async () => {
    await binding.prepare("INSERT INTO users VALUES ('other')").run()
    const passkey = await auth.issueSession('owner', 'mac', 'passkey')
    const apple = await auth.issueSession('owner', 'mac', 'apple')
    const pkce = await auth.exchange(await request())
    const otherUser = await auth.issueSession('other', 'mac', 'passkey')
    await auth.revokeUserGrant('owner', 'passkey')
    expect(await auth.resolve(passkey.accessToken)).toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: passkey.refreshToken }),
    ).rejects.toThrow()
    expect(await auth.resolve(apple.accessToken)).not.toBeNull()
    expect(await auth.resolve(pkce.accessToken)).not.toBeNull()
    expect(await auth.resolve(otherUser.accessToken)).not.toBeNull()
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

  it('issues a direct session that resolves, rotates and stores no raw credential', async () => {
    const token = await auth.issueSession('owner', 'mac', 'passkey')
    expect(token).toMatchObject({ tokenType: 'Bearer', expiresIn: 300 })
    expect(token.refreshExpiresAt).toBe(now + 30 * 24 * 60 * 60)
    expect(await auth.resolve(token.accessToken)).toMatchObject({
      userId: 'owner',
      clientId: 'mac',
      sessionId: token.sessionId,
    })
    const row = await binding
      .prepare('SELECT * FROM auth_native_sessions WHERE id = ?')
      .bind(token.sessionId)
      .first()
    expect(row).toMatchObject({ redirect_uri: 'native:passkey', code_hash: null })
    expect(JSON.stringify(row)).not.toContain(token.accessToken)
    expect(JSON.stringify(row)).not.toContain(token.refreshToken)
    const refreshed = await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    expect(refreshed.sessionId).toBe(token.sessionId)
    expect(refreshed.refreshExpiresAt).toBe(token.refreshExpiresAt)
    expect(await auth.resolve(token.accessToken)).toBeNull()
  })

  it('refuses a direct session for an unconfigured client', async () => {
    await expect(auth.issueSession('owner', 'other', 'apple')).rejects.toThrow()
  })

  it('gives a direct session no code an exchange could redeem', async () => {
    const token = await auth.issueSession('owner', 'mac', 'apple')
    await expect(
      auth.exchange({
        clientId: 'mac',
        redirectUri: 'native:apple',
        code: nativeAuthSecret(),
        codeVerifier: nativeAuthSecret(),
      }),
    ).rejects.toThrow()
    expect(await auth.resolve(token.accessToken)).not.toBeNull()
  })

  it('revokes direct sessions with the user', async () => {
    const token = await auth.issueSession('owner', 'mac', 'apple')
    await auth.revokeUser('owner')
    expect(await auth.resolve(token.accessToken)).toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toThrow()
  })

  it('cascades account deletion to native credentials', async () => {
    const token = await auth.exchange(await request())
    await auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken })
    await binding.prepare("DELETE FROM users WHERE id = 'owner'").run()
    const spent = await binding
      .prepare('SELECT COUNT(*) AS n FROM auth_native_refreshes WHERE session_id = ?')
      .bind(token.sessionId)
      .first()
    expect(spent).toEqual({ n: 0 })
    expect(await auth.resolve(token.accessToken)).toBeNull()
    await expect(
      auth.refresh({ clientId: 'mac', refreshToken: token.refreshToken }),
    ).rejects.toThrow()
  })
})
