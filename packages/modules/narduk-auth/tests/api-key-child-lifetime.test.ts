/**
 * A key minted by another API key may not outlive it (narduk-libs#920).
 *
 * The scope ceiling (#858) bounded what a child key may do, not how long it
 * lives. A key holding `auth:api-keys:write` could mint a copy of itself with
 * `expiresInDays: null`, and a `*` key could mint a fresh 90-day `*` key
 * before it expired, forever. Session callers keep today's behaviour.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import apiKeysPost from '../server/api/auth/api-keys.post'
import { boundChildApiKeyExpiry } from '../shared/utils/api-key-lifetime'

import { databaseStub } from './stubs/layer-database'

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
}

const WRITE = 'auth:api-keys:write'
const DEPLOY = 'deploy:write'
const DAY = 86_400
/** The layer-auth stub's clock: `resolveApiKeyExpiry` counts days from here. */
const NOW = 1_700_000_000

const handler = (apiKeysPost as unknown as CapturedMutation).__handler

function keyCaller(scopes: string[], expiresAt: number | null) {
  return { authMethod: 'api-key', id: 'user-1', scopes, apiKey: { id: 'parent-key', expiresAt } }
}

function mint(user: Record<string, unknown>, body: Record<string, unknown>) {
  return handler({ event: {}, user, body: { name: 'child', ...body } })
}

const OUTLIVES = {
  statusCode: 403,
  message: 'An API key cannot mint a key that outlives it.',
}

describe('boundChildApiKeyExpiry', () => {
  it('keeps a child that ends no later than its parent', () => {
    expect(boundChildApiKeyExpiry(NOW + DAY, NOW + 2 * DAY, true)).toEqual({
      ok: true,
      expiresAt: NOW + DAY,
    })
    expect(boundChildApiKeyExpiry(NOW + DAY, NOW + DAY, true)).toEqual({
      ok: true,
      expiresAt: NOW + DAY,
    })
  })

  it('refuses an explicit expiry past the parent, or none, when the parent expires', () => {
    expect(boundChildApiKeyExpiry(NOW + 3 * DAY, NOW + DAY, true)).toEqual({ ok: false })
    expect(boundChildApiKeyExpiry(null, NOW + DAY, true)).toEqual({ ok: false })
  })

  it('clamps the default expiry to the parent', () => {
    expect(boundChildApiKeyExpiry(NOW + 30 * DAY, NOW + DAY, false)).toEqual({
      ok: true,
      expiresAt: NOW + DAY,
    })
  })

  it('leaves the child alone when the parent never expires', () => {
    expect(boundChildApiKeyExpiry(null, null, true)).toEqual({ ok: true, expiresAt: null })
    expect(boundChildApiKeyExpiry(NOW + DAY, null, true)).toEqual({
      ok: true,
      expiresAt: NOW + DAY,
    })
  })
})

describe('POST /api/auth/api-keys child lifetime', () => {
  beforeEach(() => {
    databaseStub.reset()
  })

  it('refuses a never-expiring child of a key that expires, before any write', async () => {
    await expect(
      mint(keyCaller([WRITE, DEPLOY], NOW + DAY), {
        scopes: [WRITE, DEPLOY],
        expiresInDays: null,
      }),
    ).rejects.toMatchObject(OUTLIVES)
    expect(databaseStub.inserts).toEqual([])
  })

  it('refuses a child that would expire after its parent', async () => {
    await expect(
      mint(keyCaller([WRITE], NOW + DAY), { scopes: [WRITE], expiresInDays: 30 }),
    ).rejects.toMatchObject(OUTLIVES)
    expect(databaseStub.inserts).toEqual([])
  })

  it('refuses a wildcard key renewing itself for another 90 days', async () => {
    await expect(
      mint(keyCaller(['*'], NOW + DAY), { scopes: ['*'], expiresInDays: 90 }),
    ).rejects.toMatchObject(OUTLIVES)
    expect(databaseStub.inserts).toEqual([])
  })

  it('clamps a child that names no expiry to its parent', async () => {
    await expect(mint(keyCaller([WRITE], NOW + DAY), { scopes: [WRITE] })).resolves.toMatchObject({
      expiresAt: NOW + DAY,
    })
  })

  it('mints a child that ends before its parent unchanged', async () => {
    await expect(
      mint(keyCaller(['*'], NOW + 60 * DAY), { scopes: ['*'], expiresInDays: 30 }),
    ).resolves.toMatchObject({ expiresAt: NOW + 30 * DAY })
  })

  it('lets a never-expiring parent mint a never-expiring narrow child', async () => {
    await expect(
      mint(keyCaller([WRITE], null), { scopes: [WRITE], expiresInDays: null }),
    ).resolves.toMatchObject({ expiresAt: null })
  })

  it('refuses an API-key caller whose key lifetime is unknown', async () => {
    await expect(
      mint({ authMethod: 'api-key', id: 'user-1', scopes: [WRITE] }, { scopes: [WRITE] }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(databaseStub.inserts).toEqual([])
  })

  it('leaves a session caller unaffected', async () => {
    await expect(
      mint(
        { authMethod: 'session', id: 'user-1', scopes: [] },
        { scopes: [WRITE], expiresInDays: null },
      ),
    ).resolves.toMatchObject({ expiresAt: null })
  })
})
