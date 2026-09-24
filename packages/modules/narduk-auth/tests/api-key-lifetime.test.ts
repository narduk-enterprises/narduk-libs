/**
 * Mint-time lifetime for a boundary-class API key (narduk-libs#168).
 *
 * `*` is the scope `hasRequiredApiKeyScopes` treats as app-wide. A key that
 * carries it is a standing credential for every non-public route behind a
 * consumer's API-key boundary, so it must expire and may not outlive the
 * documented ceiling. Narrow machine scopes may still omit expiry.
 *
 * The unique index on `api_keys.key_hash` lives in narduk-core (migration
 * 0007 / narduk-libs#739). This package owns the mint path that used to
 * honour `expiresInDays === null` for the wildcard.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import apiKeysPost from '../server/api/auth/api-keys.post'
import {
  BOUNDARY_API_KEY_MAX_EXPIRY_DAYS,
  DEFAULT_API_KEY_EXPIRY_DAYS,
  isBoundaryClassApiKey,
  resolveApiKeyMintExpiry,
} from '../shared/utils/api-key-lifetime'

import { databaseStub } from './stubs/layer-database'

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
}

function captured(route: unknown): CapturedMutation {
  return route as unknown as CapturedMutation
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('isBoundaryClassApiKey', () => {
  it('treats the wildcard scope as boundary-class, including around whitespace', () => {
    expect(isBoundaryClassApiKey(['*'])).toBe(true)
    expect(isBoundaryClassApiKey(['registry:read', ' * '])).toBe(true)
    expect(isBoundaryClassApiKey(['registry:read'])).toBe(false)
    expect(isBoundaryClassApiKey([])).toBe(false)
  })
})

describe('resolveApiKeyMintExpiry', () => {
  it('refuses a never-expiring wildcard API key', () => {
    expect(resolveApiKeyMintExpiry(['*'], null)).toEqual({
      ok: false,
      reason: 'boundary-unbounded',
    })
  })

  it('refuses a wildcard API key past the 90-day ceiling', () => {
    expect(resolveApiKeyMintExpiry(['*'], BOUNDARY_API_KEY_MAX_EXPIRY_DAYS + 1)).toEqual({
      ok: false,
      reason: 'boundary-ceiling',
    })
    expect(resolveApiKeyMintExpiry(['*'], 365)).toEqual({
      ok: false,
      reason: 'boundary-ceiling',
    })
  })

  it('accepts a wildcard API key at or under the ceiling, defaulting omitted days', () => {
    expect(resolveApiKeyMintExpiry(['*'], BOUNDARY_API_KEY_MAX_EXPIRY_DAYS)).toEqual({
      ok: true,
      expiresInDays: BOUNDARY_API_KEY_MAX_EXPIRY_DAYS,
    })
    expect(resolveApiKeyMintExpiry(['*'], 7)).toEqual({ ok: true, expiresInDays: 7 })
    expect(resolveApiKeyMintExpiry(['*'], undefined)).toEqual({
      ok: true,
      expiresInDays: DEFAULT_API_KEY_EXPIRY_DAYS,
    })
  })

  it('still allows a never-expiring narrow machine key', () => {
    expect(resolveApiKeyMintExpiry(['registry:read'], null)).toEqual({
      ok: true,
      expiresInDays: null,
    })
    expect(resolveApiKeyMintExpiry(['registry:read'], 365)).toEqual({
      ok: true,
      expiresInDays: 365,
    })
    expect(resolveApiKeyMintExpiry([], undefined)).toEqual({
      ok: true,
      expiresInDays: DEFAULT_API_KEY_EXPIRY_DAYS,
    })
  })
})

describe('POST /api/auth/api-keys mint path', () => {
  const handler = captured(apiKeysPost).__handler

  beforeEach(() => {
    databaseStub.reset()
  })

  it('applies the mint-time verdict before insert', () => {
    const source = readFileSync(join(packageRoot, 'server/api/auth/api-keys.post.ts'), 'utf8')
    expect(source).toContain('resolveApiKeyMintExpiry')
    expect(source).toContain("reason === 'boundary-unbounded'")
    expect(source).not.toContain('const expiresAt = resolveApiKeyExpiry(input.expiresInDays)')
  })

  it('refuses a never-expiring wildcard API key at the handler', async () => {
    await expect(
      handler({
        event: {},
        user: { id: 'user-1' },
        body: { name: 'ops', scopes: ['*'], expiresInDays: null },
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'A wildcard API key must have an expiry.' })
  })

  it('refuses a wildcard API key past the 90-day ceiling at the handler', async () => {
    await expect(
      handler({
        event: {},
        user: { id: 'user-1' },
        body: { name: 'ops', scopes: ['*'], expiresInDays: 365 },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'A wildcard API key cannot expire more than 90 days from now.',
    })
  })

  it('mints a bounded wildcard API key', async () => {
    await expect(
      handler({
        event: {},
        user: { id: 'user-1' },
        body: { name: 'ops', scopes: ['*'], expiresInDays: 30 },
      }),
    ).resolves.toMatchObject({
      name: 'ops',
      scopes: ['*'],
      rawKey: 'nk_testkey',
      // Stubbed `resolveApiKeyExpiry(30)` in tests/stubs/layer-auth.ts. A
      // handler that skips `mintExpiry.expiresInDays` and returns the raw
      // `expiresInDays` (or omits expiry) fails this.
      expiresAt: 1_700_000_000 + 30 * 86_400,
    })
  })
})
