import { readFileSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { drizzle } from 'drizzle-orm/d1'
import { createEvent } from 'h3'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import authorizeRoute from '../server/api/auth/native/authorize.post'
import { nativeAuthDigest, nativeAuthSecret } from '../server/lib/app-auth/native-core'
import { nativeAuthClients, requireNativeAuthorizationOrigin } from '../server/utils/native-auth'
import {
  getLocalEmailVerification,
  recordLocalEmailVerification,
} from '../server/utils/verified-email'

import type { AppSessionUser } from '../server/lib/app-auth/types'

const TEST_ORIGIN = 'http://localhost:3000'
const OWNER_EMAIL = 'owner@example.com'

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof drizzle> | null,
  user: null as AppSessionUser | null,
  config: {
    authBackend: 'local',
    authNativeClients: [{ id: 'mac', name: 'Test Mac', redirectUris: ['com.example.test:/auth'] }],
    authLocalEmailVerification: true,
    public: { appUrl: 'http://localhost:3000', authRequireMfa: false },
  },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('../server/utils/auth-bridge-database', () => ({ useAuthBridgeDatabase: () => state.db }))
vi.mock('../server/lib/app-auth/session', () => ({ getCurrentSessionUser: () => state.user }))
vi.mock('../server/utils/session-user', () => ({ useRefreshedSessionUser: () => state.user }))
vi.mock('#layer/server/utils/database', () => ({ useDatabase: () => state.db }))

function event(origin?: string, host = 'localhost:3000') {
  const req = new IncomingMessage(new Socket())
  req.url = '/api/auth/native/authorize'
  req.method = 'POST'
  req.headers = { host, ...(origin ? { origin } : {}) }
  return createEvent(req, new ServerResponse(req))
}

describe('native authorization and email verification request boundaries', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  beforeAll(async () => {
    const binding = await runtime.getD1Database('DB')
    await binding.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run()
    const migration = readFileSync(
      new URL('../drizzle/0004_native_auth.sql', import.meta.url),
      'utf8',
    )
    await binding.batch(
      migration
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => binding.prepare(s)),
    )
    await binding.prepare("INSERT INTO users VALUES ('owner')").run()
    state.db = drizzle(binding)
  })
  beforeEach(() => {
    state.user = null
    state.config.authBackend = 'local'
    state.config.authLocalEmailVerification = true
    state.config.public.authRequireMfa = false
  })
  afterAll(() => runtime.dispose())

  it('requires both the configured request host and an explicit same-origin browser header', () => {
    expect(() => requireNativeAuthorizationOrigin(event(TEST_ORIGIN))).not.toThrow()
    expect(() => requireNativeAuthorizationOrigin(event())).toThrow()
    expect(() => requireNativeAuthorizationOrigin(event('https://attacker.test'))).toThrow()
    expect(() => requireNativeAuthorizationOrigin(event(TEST_ORIGIN, 'attacker.test'))).toThrow()
  })

  it('keeps native sessions disabled for unsupported authentication backends', () => {
    state.config.authBackend = 'supabase'
    expect(() => nativeAuthClients(event())).toThrow()
  })

  it('parses the configured native client allowlist at the consuming app boundary', () => {
    expect(nativeAuthClients(event())).toEqual(state.config.authNativeClients)
    const client = state.config.authNativeClients[0]!
    const saved = client.redirectUris
    client.redirectUris = ['not a URL']
    expect(() => nativeAuthClients(event())).toThrow('not configured correctly')
    client.redirectUris = saved
  })

  it('does not treat an email address or disabled verification feature as proof', async () => {
    expect(await getLocalEmailVerification(event(), 'owner', OWNER_EMAIL)).toBeNull()
    state.config.authLocalEmailVerification = false
    await recordLocalEmailVerification(event(), 'owner', OWNER_EMAIL, '2026-09-09T12:00:00Z')
    state.config.authLocalEmailVerification = true
    expect(await getLocalEmailVerification(event(), 'owner', OWNER_EMAIL)).toBeNull()
  })

  it('matches a completed email proof to the user and current normalized address', async () => {
    await recordLocalEmailVerification(
      event(),
      'owner',
      ' Owner@example.com ',
      '2026-09-09T12:00:00Z',
    )
    expect(await getLocalEmailVerification(event(), 'owner', OWNER_EMAIL)).toBe(
      '2026-09-09T12:00:00Z',
    )
    expect(await getLocalEmailVerification(event(), 'owner', 'changed@example.com')).toBeNull()
    expect(await getLocalEmailVerification(event(), 'other', OWNER_EMAIL)).toBeNull()
  })

  it('mints a code only for a current, fully authenticated local account', async () => {
    const route = authorizeRoute as unknown as { __handler: (context: unknown) => Promise<unknown> }
    const context = {
      event: event(TEST_ORIGIN),
      body: {
        clientId: 'mac',
        redirectUri: 'com.example.test:/auth',
        codeChallenge: await nativeAuthDigest(nativeAuthSecret()),
        codeChallengeMethod: 'S256',
        state: nativeAuthSecret(),
      },
    }
    await expect(route.__handler(context)).rejects.toThrow()
    state.user = { id: 'owner', authBackend: 'local', recoveryMode: true } as AppSessionUser
    await expect(route.__handler(context)).rejects.toThrow()
    state.user = { id: 'deleted', authBackend: 'local' } as AppSessionUser
    await expect(route.__handler(context)).rejects.toThrow()
    state.user = { id: 'owner', authBackend: 'local', aal: 'aal1' } as AppSessionUser
    state.config.public.authRequireMfa = true
    expect(await route.__handler(context)).toMatchObject({
      redirectTo: expect.stringContaining('com.example.test:/auth?code='),
    })
  })
})
