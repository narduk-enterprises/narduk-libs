/**
 * `GET /api/auth/session/exchange` throttle (narduk-libs#879).
 *
 * The GET route runs the same Supabase exchange as its POST twin, which
 * `definePublicMutation` binds to `RATE_LIMIT_POLICIES.authLogin`. GET is a
 * plain `defineEventHandler`, so it must enforce that policy itself, before it
 * reaches Supabase.
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createError, createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import exchangeGet from '../server/api/auth/session/exchange.get'
import exchangePost from '../server/api/auth/session/exchange.post'

import { RATE_LIMIT_POLICIES, rateLimitStub } from './stubs/layer-rate-limit'

import type { H3Event } from 'h3'

const exchange = vi.hoisted(() => ({ calls: 0 }))

vi.mock('#narduk-auth-server/utils/app-auth', () => ({
  exchangeSupabaseCode: async () => {
    exchange.calls += 1
    return { redirectTo: '/dashboard/' }
  },
}))

const EXCHANGE_URL = '/api/auth/session/exchange?code=pkce-code'

function requestEvent(url: string): H3Event {
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.url = url
  request.headers = { host: 'app.test' }
  return createEvent(request, new ServerResponse(request))
}

describe('GET /api/auth/session/exchange rate limit', () => {
  beforeEach(() => {
    rateLimitStub.reset()
    exchange.calls = 0
  })

  it('enforces the same authLogin policy as the POST twin', async () => {
    await exchangeGet(requestEvent(EXCHANGE_URL))

    expect(rateLimitStub.calls).toEqual([RATE_LIMIT_POLICIES.authLogin])
    const post = exchangePost as unknown as { __options: { rateLimit: unknown } }
    expect(post.__options.rateLimit).toBe(RATE_LIMIT_POLICIES.authLogin)
    expect(exchange.calls).toBe(1)
  })

  it('refuses a throttled caller before the Supabase exchange', async () => {
    rateLimitStub.reject = createError({ statusCode: 429, statusMessage: 'Too Many Requests' })

    await expect(exchangeGet(requestEvent(EXCHANGE_URL))).rejects.toMatchObject({
      statusCode: 429,
    })
    await expect(
      exchangeGet(requestEvent('/api/auth/session/exchange?token_hash=x&type=recovery')),
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(exchange.calls).toBe(0)
  })

  it('throttles malformed callbacks too, before validation', async () => {
    rateLimitStub.reject = createError({ statusCode: 429, statusMessage: 'Too Many Requests' })

    await expect(exchangeGet(requestEvent('/api/auth/session/exchange'))).rejects.toMatchObject({
      statusCode: 429,
    })
  })
})
