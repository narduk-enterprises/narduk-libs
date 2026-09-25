/**
 * Mint-time scope ceiling (narduk-libs#858).
 *
 * `POST /api/auth/api-keys` requires only `auth:api-keys:write`. A key that
 * holds just that scope must not be able to mint a `*` key (or any scope it
 * lacks); that would escalate a narrow machine credential to every scope.
 * Session callers keep today's behaviour.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import apiKeysPost from '../server/api/auth/api-keys.post'
import { findScopesBeyondCaller } from '../shared/utils/api-key-scope-ceiling'

import { databaseStub } from './stubs/layer-database'

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
}

const WRITE = 'auth:api-keys:write'
const REGISTRY_READ = 'registry:read'

const handler = (apiKeysPost as unknown as CapturedMutation).__handler

function apiKeyCaller(scopes: string[]) {
  return { authMethod: 'api-key', id: 'user-1', scopes }
}

describe('findScopesBeyondCaller', () => {
  it('refuses the wildcard to a caller without it', () => {
    expect(findScopesBeyondCaller(['*'], [WRITE])).toEqual(['*'])
  })

  it('names every requested scope the caller lacks, once, in request order', () => {
    expect(
      findScopesBeyondCaller([REGISTRY_READ, WRITE, 'registry:write', REGISTRY_READ], [WRITE]),
    ).toEqual([REGISTRY_READ, 'registry:write'])
  })

  it('allows a subset of the caller scopes, including none', () => {
    expect(findScopesBeyondCaller([WRITE], [WRITE])).toEqual([])
    expect(findScopesBeyondCaller([], [WRITE])).toEqual([])
  })

  it('lets a wildcard caller mint anything, including the wildcard', () => {
    expect(findScopesBeyondCaller(['*', 'registry:write'], [' * '])).toEqual([])
  })

  it('compares trimmed scopes', () => {
    expect(findScopesBeyondCaller([' registry:read '], [REGISTRY_READ])).toEqual([])
  })
})

describe('POST /api/auth/api-keys scope ceiling', () => {
  beforeEach(() => {
    databaseStub.reset()
  })

  it('refuses a wildcard mint from an auth:api-keys:write-only key with 403', async () => {
    await expect(
      handler({
        event: {},
        user: apiKeyCaller([WRITE]),
        body: { name: 'escalate', scopes: ['*'], expiresInDays: 30 },
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'An API key cannot mint scopes it does not hold: *',
    })
  })

  it('refuses any scope the calling key does not hold', async () => {
    await expect(
      handler({
        event: {},
        user: apiKeyCaller([WRITE]),
        body: { name: 'widen', scopes: [WRITE, 'registry:write'] },
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'An API key cannot mint scopes it does not hold: registry:write',
    })
  })

  it('lets the same key mint auth:api-keys:write', async () => {
    await expect(
      handler({
        event: {},
        user: apiKeyCaller([WRITE]),
        body: { name: 'rotate', scopes: [WRITE] },
      }),
    ).resolves.toMatchObject({ name: 'rotate', scopes: [WRITE] })
  })

  it('lets a wildcard key mint a bounded wildcard key', async () => {
    await expect(
      handler({
        event: {},
        user: apiKeyCaller(['*']),
        body: { name: 'ops', scopes: ['*'], expiresInDays: 30 },
      }),
    ).resolves.toMatchObject({ name: 'ops', scopes: ['*'] })
  })

  it('leaves a session user unaffected', async () => {
    await expect(
      handler({
        event: {},
        user: { authMethod: 'session', id: 'user-1', scopes: [] },
        body: { name: 'ops', scopes: ['*'], expiresInDays: 30 },
      }),
    ).resolves.toMatchObject({ name: 'ops', scopes: ['*'] })
  })
})
