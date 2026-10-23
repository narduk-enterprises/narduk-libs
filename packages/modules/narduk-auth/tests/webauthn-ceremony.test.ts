import { describe, expect, it, vi } from 'vitest'

import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
  type PasskeyCeremonyContext,
  type PasskeyCredentialRecord,
  type PasskeyStore,
  removePasskey,
  type StoredWebauthnChallenge,
} from '../server/lib/app-auth/webauthn-ceremony'

import type { WebauthnServer } from '../server/lib/app-auth/webauthn-server'
import type { ResolvedWebauthnConfig } from '../shared/utils/webauthn-config'

const CONFIG: ResolvedWebauthnConfig = {
  enabled: true,
  challengeTtlSeconds: 300,
  origins: ['https://staging.pacctrac.com'],
  rpId: 'staging.pacctrac.com',
  rpName: 'PACC·TRAC',
}

const b64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
const clientData = (challenge: string) =>
  b64url(JSON.stringify({ type: 'webauthn.get', challenge }))

function memoryStore() {
  const credentials = new Map<string, PasskeyCredentialRecord>()
  const challenges = new Map<string, StoredWebauthnChallenge>()
  const store: PasskeyStore = {
    listCredentials: async (userId) => [...credentials.values()].filter((c) => c.userId === userId),
    findCredential: async (id) => credentials.get(id) ?? null,
    insertCredential: async (record) => {
      if (credentials.has(record.id)) return false
      credentials.set(record.id, { ...record })
      return true
    },
    advanceCredential: async (id, expected, next) => {
      const row = credentials.get(id)
      if (!row || row.counter !== expected) return false
      credentials.set(id, { ...row, ...next })
      return true
    },
    deleteCredential: async (userId, id) =>
      credentials.get(id)?.userId === userId && credentials.delete(id),
    issueChallenge: async (hash, challenge) => {
      challenges.set(hash, challenge)
      return true
    },
    consumeChallenge: async (hash) => {
      const row = challenges.get(hash) ?? null
      challenges.delete(hash)
      return row
    },
  }
  return { store, credentials, challenges }
}

/** A stand-in for @simplewebauthn/server: options carry a counter-numbered challenge, verification is scripted. */
function fakeServer(over: { newCounter?: number; verified?: boolean } = {}) {
  let n = 0
  const server = {
    generateRegistrationOptions: vi.fn(async () => ({ challenge: `reg-${++n}` })),
    generateAuthenticationOptions: vi.fn(async () => ({ challenge: `auth-${++n}` })),
    verifyRegistrationResponse: vi.fn(async ({ response }: { response: { id: string } }) => ({
      verified: over.verified ?? true,
      registrationInfo: {
        credential: {
          id: response.id,
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
      },
    })),
    verifyAuthenticationResponse: vi.fn(async () => ({
      verified: over.verified ?? true,
      authenticationInfo: {
        newCounter: over.newCounter ?? 0,
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
      },
    })),
    isoBase64URL: {
      fromBuffer: (buf: Uint8Array) => Buffer.from(buf).toString('base64url'),
      toBuffer: (value: string) => new Uint8Array(Buffer.from(value, 'base64url')),
      toUTF8String: (value: string) => Buffer.from(value, 'base64url').toString('utf8'),
    },
  }
  return server as unknown as WebauthnServer & typeof server
}

function context(over: Partial<PasskeyCeremonyContext> = {}) {
  const mem = memoryStore()
  let clock = Date.parse('2026-10-23T12:00:00Z')
  const ctx: PasskeyCeremonyContext = {
    config: CONFIG,
    server: fakeServer(),
    store: mem.store,
    now: () => clock,
    ...over,
  }
  return {
    ctx,
    ...mem,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const CRED_1 = 'cred-1'

const regResponse = (challenge: string, id = CRED_1) =>
  ({
    id,
    rawId: id,
    type: 'public-key',
    response: { clientDataJSON: clientData(challenge), attestationObject: 'x' },
    clientExtensionResults: {},
  }) as never
const authResponse = (challenge: string, id = CRED_1, userHandle?: string) =>
  ({
    id,
    rawId: id,
    type: 'public-key',
    response: {
      clientDataJSON: clientData(challenge),
      authenticatorData: 'x',
      signature: 'x',
      ...(userHandle ? { userHandle: b64url(userHandle) } : {}),
    },
    clientExtensionResults: {},
  }) as never

const CAROLINA_ID = 'u-carolina'
const CAROLINA = { id: CAROLINA_ID, name: 'carolina@k2.test' }

async function enrol(ctx: PasskeyCeremonyContext, account = CAROLINA, id = CRED_1) {
  const options = await beginPasskeyRegistration(ctx, account)
  return finishPasskeyRegistration(ctx, account, {
    response: regResponse(options.challenge, id),
    name: '  MacBook  ',
  })
}

describe('passkey registration', () => {
  it('stores the credential under the configured RP ID and the session account', async () => {
    const { ctx, credentials } = context()
    const summary = await enrol(ctx)
    expect(summary).toMatchObject({
      id: CRED_1,
      name: 'MacBook',
      deviceType: 'multiDevice',
      backedUp: true,
    })
    expect(credentials.get(CRED_1)).toMatchObject({
      userId: CAROLINA_ID,
      rpId: 'staging.pacctrac.com',
      counter: 0,
    })
  })

  it('refuses a replayed registration response: the challenge is single-use', async () => {
    const { ctx } = context()
    const options = await beginPasskeyRegistration(ctx, CAROLINA)
    await finishPasskeyRegistration(ctx, CAROLINA, { response: regResponse(options.challenge) })
    await expect(
      finishPasskeyRegistration(ctx, CAROLINA, {
        response: regResponse(options.challenge, 'cred-2'),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses an expired challenge, and burns it', async () => {
    const { ctx, challenges, advance } = context()
    const options = await beginPasskeyRegistration(ctx, CAROLINA)
    advance(301_000)
    await expect(
      finishPasskeyRegistration(ctx, CAROLINA, { response: regResponse(options.challenge) }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(challenges.size).toBe(0)
  })

  it('refuses a challenge issued to another account', async () => {
    const { ctx, credentials } = context()
    const options = await beginPasskeyRegistration(ctx, { id: 'u-other', name: 'other@k2.test' })
    await expect(
      finishPasskeyRegistration(ctx, CAROLINA, { response: regResponse(options.challenge) }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(credentials.size).toBe(0)
  })

  it('burns the challenge when verification fails, so it is no oracle', async () => {
    const { ctx, challenges } = context({ server: fakeServer({ verified: false }) })
    const options = await beginPasskeyRegistration(ctx, CAROLINA)
    await expect(
      finishPasskeyRegistration(ctx, CAROLINA, { response: regResponse(options.challenge) }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(challenges.size).toBe(0)
  })

  it('never rebinds an existing credential id to a second account', async () => {
    const { ctx, credentials } = context()
    await enrol(ctx)
    await expect(enrol(ctx, { id: 'u-other', name: 'other@k2.test' })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(credentials.get(CRED_1)?.userId).toBe(CAROLINA_ID)
  })

  it("excludes the account's existing credentials and uses the prefixed user handle", async () => {
    const server = fakeServer()
    const { ctx } = context({ server, userHandlePrefix: 'client:' })
    await enrol(ctx)
    await beginPasskeyRegistration(ctx, CAROLINA)
    const args = server.generateRegistrationOptions.mock.calls.at(-1)![0] as unknown as {
      excludeCredentials: Array<{ id: string }>
      rpID: string
      userID: Uint8Array
    }
    expect(new TextDecoder().decode(args.userID)).toBe('client:u-carolina')
    expect(args.excludeCredentials.map((c) => c.id)).toEqual([CRED_1])
    expect(args.rpID).toBe('staging.pacctrac.com')
  })
})

describe('passkey sign-in', () => {
  it('resolves the account the credential belongs to and advances last-used', async () => {
    const { ctx, credentials } = context()
    await enrol(ctx)
    const options = await beginPasskeyAuthentication(ctx)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge, CRED_1, CAROLINA_ID)),
    ).resolves.toEqual({ credentialId: CRED_1, userId: CAROLINA_ID })
    expect(credentials.get(CRED_1)?.lastUsedAt).toBe('2026-10-23T12:00:00.000Z')
  })

  it('refuses a replayed assertion', async () => {
    const { ctx } = context()
    await enrol(ctx)
    const options = await beginPasskeyAuthentication(ctx)
    await finishPasskeyAuthentication(ctx, authResponse(options.challenge))
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses an expired sign-in challenge', async () => {
    const { ctx, advance } = context()
    await enrol(ctx)
    const options = await beginPasskeyAuthentication(ctx)
    advance(300_000)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses a registration challenge presented at sign-in, and burns it', async () => {
    const { ctx, challenges } = context()
    await enrol(ctx)
    const options = await beginPasskeyRegistration(ctx, CAROLINA)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(challenges.size).toBe(0)
  })

  it('refuses a challenge issued under another namespace', async () => {
    const shared = memoryStore()
    const staff = context({ store: shared.store, namespace: 'staff' }).ctx
    const client = context({ store: shared.store, namespace: 'client' }).ctx
    await enrol(staff)
    const options = await beginPasskeyAuthentication(staff)
    await expect(
      finishPasskeyAuthentication(client, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses a credential registered under another RP ID', async () => {
    const { ctx, store } = context()
    await enrol(ctx)
    const demo = {
      ...ctx,
      config: { ...CONFIG, rpId: 'demo.pacctrac.com', origins: ['https://demo.pacctrac.com'] },
    }
    const options = await beginPasskeyAuthentication(demo)
    await expect(
      finishPasskeyAuthentication({ ...demo, store }, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it("refuses a user handle that is not the credential's account", async () => {
    const { ctx } = context()
    await enrol(ctx)
    const options = await beginPasskeyAuthentication(ctx)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge, CRED_1, 'u-other')),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses a regressed signature counter', async () => {
    const { ctx, credentials } = context({ server: fakeServer({ newCounter: 5 }) })
    await enrol(ctx)
    credentials.set(CRED_1, { ...credentials.get(CRED_1)!, counter: 9 })
    const options = await beginPasskeyAuthentication(ctx)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('refuses an unknown credential', async () => {
    const { ctx } = context()
    const options = await beginPasskeyAuthentication(ctx)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge, 'nope')),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('passkey removal', () => {
  it("removes the caller's own passkey and nobody else's", async () => {
    const { ctx } = context()
    await enrol(ctx)
    await enrol(ctx, { id: 'u-other', name: 'other@k2.test' }, 'cred-2')
    await expect(removePasskey(ctx, CAROLINA_ID, 'cred-2')).rejects.toMatchObject({
      statusCode: 404,
    })
    await removePasskey(ctx, CAROLINA_ID, CRED_1)
    expect(await listPasskeys(ctx, CAROLINA_ID)).toEqual([])
    expect((await listPasskeys(ctx, 'u-other')).map((p) => p.id)).toEqual(['cred-2'])
  })

  it('a removed passkey no longer signs in', async () => {
    const { ctx } = context()
    await enrol(ctx)
    await removePasskey(ctx, CAROLINA_ID, CRED_1)
    const options = await beginPasskeyAuthentication(ctx)
    await expect(
      finishPasskeyAuthentication(ctx, authResponse(options.challenge)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
