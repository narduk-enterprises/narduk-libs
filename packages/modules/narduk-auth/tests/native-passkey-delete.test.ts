import { readFileSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { drizzle } from 'drizzle-orm/d1'
import { createEvent } from 'h3'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import deletePasskeyRoute from '../server/api/auth/passkeys/[id].delete'
import { createNativeAuth } from '../server/lib/app-auth/native-core'

/**
 * DELETE /api/auth/passkeys/:id ends the native-app sessions minted by a
 * passkey sign-in (narduk-libs#2179). The credential delete itself
 * (`deletePasskey`) is tested in the webauthn suites and stubbed here.
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  config: {
    authBackend: 'local',
    authNativeClients: [] as unknown[],
    public: { appUrl: 'http://localhost:3000' },
  },
  deletePasskey: vi.fn(),
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('../server/utils/auth-bridge-database', () => ({ useAuthBridgeDatabase: () => state.db }))
vi.mock('#narduk-auth-server/lib/app-auth/webauthn-core', () => ({
  assertPasskeyManagementPrincipal: () => {},
  deletePasskey: state.deletePasskey,
}))

interface Handler {
  __handler: (context: unknown) => Promise<Record<string, unknown>>
}
const route = deletePasskeyRoute as unknown as Handler
const CLIENTS = [{ id: 'ios', name: 'Test iPhone', redirectUris: ['com.example.test:/auth'] }]

function event(id: string) {
  const req = new IncomingMessage(new Socket())
  req.url = `/api/auth/passkeys/${id}`
  req.method = 'DELETE'
  req.headers = { host: 'localhost:3000' }
  const e = createEvent(req, new ServerResponse(req))
  e.context.params = { id }
  return e
}

describe('DELETE /api/auth/passkeys/:id and native sessions', () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
  })
  let native: ReturnType<typeof createNativeAuth>
  let database: unknown

  beforeAll(async () => {
    const binding = await runtime.getD1Database('DB')
    await binding.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run()
    const migration = ['0004_native_auth.sql', '0007_native_refresh_reuse.sql']
      .map((name) => readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'))
      .join(';')
    await binding.batch(
      migration
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => binding.prepare(s)),
    )
    await binding.prepare("INSERT INTO users VALUES ('owner')").run()
    database = drizzle(binding)
    native = createNativeAuth(drizzle(binding), CLIENTS)
  })
  beforeEach(() => {
    state.db = database
    state.config.authBackend = 'local'
    state.config.authNativeClients = CLIENTS
    state.deletePasskey.mockReset().mockResolvedValue(undefined)
  })
  afterAll(() => runtime.dispose())

  it('ends the passkey-minted native sessions and leaves Apple sessions alive', async () => {
    const passkey = await native.issueSession('owner', 'ios', 'passkey')
    const apple = await native.issueSession('owner', 'ios', 'apple')
    const e = event('cred-1')
    expect(await route.__handler({ event: e, user: { id: 'owner' } })).toEqual({ success: true })
    expect(state.deletePasskey).toHaveBeenCalledWith(e, 'owner', 'cred-1')
    expect(await native.resolve(passkey.accessToken)).toBeNull()
    await expect(
      native.refresh({ clientId: 'ios', refreshToken: passkey.refreshToken }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(await native.resolve(apple.accessToken)).toMatchObject({ sessionId: apple.sessionId })
  })

  it("revokes nothing when the passkey is not the caller's", async () => {
    const passkey = await native.issueSession('owner', 'ios', 'passkey')
    state.deletePasskey.mockRejectedValue(
      Object.assign(new Error('Passkey not found'), { statusCode: 404 }),
    )
    await expect(
      route.__handler({ event: event('someone-elses'), user: { id: 'owner' } }),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(await native.resolve(passkey.accessToken)).not.toBeNull()
  })

  it('still deletes the passkey in an app without native clients', async () => {
    // Such an app may not have applied the native migrations at all.
    state.config.authNativeClients = []
    state.db = null
    expect(await route.__handler({ event: event('cred-2'), user: { id: 'owner' } })).toEqual({
      success: true,
    })
    expect(state.deletePasskey).toHaveBeenCalledOnce()
  })
})
