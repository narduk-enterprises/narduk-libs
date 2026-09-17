import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAuth } from '../runtime/server/utils/auth'
import {
  setSessionGrantValidator,
  validateSealedSessionGrant,
} from '../runtime/server/utils/sessionGrant'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const sessionState = vi.hoisted(() => ({
  user: null as null | {
    email: string
    id: string
    isAdmin: boolean
    name: string
  },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ databaseBackend: 'd1' }),
}))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
vi.mock('#narduk-core/schema', () => ({ apiKeys: {}, sessions: {}, users: {} }))
vi.mock('../runtime/server/utils/user-session', () => ({
  getLayerUserSession: async () => ({ id: 'nuxt-session', user: sessionState.user }),
}))

const COOKIE_USER = {
  id: 'user-1',
  email: 'parent@example.com',
  name: 'Parent',
  isAdmin: false,
}

function requestEvent(): H3Event {
  const request = {
    headers: {},
    method: 'GET',
    url: '/api/protected',
  } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  return createEvent(request, response)
}

describe('requireAuth sealed-session grant seam', () => {
  beforeEach(() => {
    sessionState.user = { ...COOKIE_USER }
  })

  it('keeps cookie-as-grant when no validator is registered', async () => {
    const event = requestEvent()

    await expect(requireAuth(event)).resolves.toMatchObject({
      ...COOKIE_USER,
      authMethod: 'session',
      scopes: [],
    })
  })

  it('fails closed with 401 when a registered validator rejects the session', async () => {
    const event = requestEvent()
    setSessionGrantValidator(event, async () => ({ status: 'invalid' }))

    await expect(requireAuth(event)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
    })
  })

  it('accepts a validator-approved principal and memoizes the grant on the request', async () => {
    const event = requestEvent()
    const validator = vi.fn(async () => ({
      status: 'valid' as const,
      user: { ...COOKIE_USER, name: 'Refreshed' },
    }))
    setSessionGrantValidator(event, validator)

    await expect(requireAuth(event)).resolves.toMatchObject({
      id: 'user-1',
      name: 'Refreshed',
      authMethod: 'session',
    })
    await expect(validateSealedSessionGrant(event, COOKIE_USER)).resolves.toMatchObject({
      status: 'valid',
      user: { name: 'Refreshed' },
    })
    expect(validator).toHaveBeenCalledTimes(1)
  })
})
