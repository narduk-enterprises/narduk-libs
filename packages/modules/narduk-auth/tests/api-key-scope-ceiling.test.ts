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
import { findScopesBeyondCaller, UNSCOPED_MINT } from '../shared/utils/api-key-scope-ceiling'

import { databaseStub } from './stubs/layer-database'

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
  __options: { parseBody: (input: unknown) => unknown }
}

const WRITE = 'auth:api-keys:write'
const REGISTRY_READ = 'registry:read'

const handler = (apiKeysPost as unknown as CapturedMutation).__handler
// Runs the route's own body schema, so an omitted `scopes` gets its real default.
const parseBody = (apiKeysPost as unknown as CapturedMutation).__options.parseBody

function apiKeyCaller(scopes: string[]) {
  // A never-expiring parent, so the child-lifetime bound (#920) stays out of the way.
  return {
    authMethod: 'api-key',
    id: 'user-1',
    scopes,
    apiKey: { id: 'parent-key', expiresAt: null },
  }
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

  it('allows a non-empty subset of the caller scopes', () => {
    expect(findScopesBeyondCaller([WRITE], [WRITE])).toEqual([])
  })

  it('refuses an unscoped mint to a scoped caller (#1122)', () => {
    expect(findScopesBeyondCaller([], [WRITE])).toEqual([UNSCOPED_MINT])
    expect(findScopesBeyondCaller(['  '], [WRITE])).toEqual([UNSCOPED_MINT])
  })

  it('allows an unscoped mint to a wildcard or unscoped caller', () => {
    expect(findScopesBeyondCaller([], ['*'])).toEqual([])
    expect(findScopesBeyondCaller([], [])).toEqual([])
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

  it('refuses an unscoped mint from a scoped key, with scopes omitted or empty (#1122)', async () => {
    for (const input of [{ name: 'unscoped' }, { name: 'unscoped', scopes: [] }]) {
      const body = parseBody(input)
      await expect(handler({ event: {}, user: apiKeyCaller([WRITE]), body })).rejects.toMatchObject(
        {
          statusCode: 403,
          message: `An API key cannot mint scopes it does not hold: ${UNSCOPED_MINT}`,
        },
      )
    }
  })

  it('lets a wildcard key mint an unscoped key', async () => {
    await expect(
      handler({ event: {}, user: apiKeyCaller(['*']), body: parseBody({ name: 'full' }) }),
    ).resolves.toMatchObject({ name: 'full', scopes: [] })
  })

  it('lets a session mint an unscoped key', async () => {
    await expect(
      handler({
        event: {},
        user: { authMethod: 'session', id: 'user-1', scopes: [] },
        body: parseBody({ name: 'full' }),
      }),
    ).resolves.toMatchObject({ name: 'full', scopes: [] })
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
