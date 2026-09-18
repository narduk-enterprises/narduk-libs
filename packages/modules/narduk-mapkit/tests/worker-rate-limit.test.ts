/**
 * narduk-libs#485: a Worker caller of `mapKitTokenResponseFromEnv` gets §e.4's limiter from the
 * Worker-safe entry point, instead of building one or reaching into the Nuxt runtime for it.
 *
 * Whether the helper should apply it BY DEFAULT is an open decision recorded on #485; this file
 * proves the limiter a caller opts into, and that the helper's default is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearMapKitTokenCacheForTests,
  createMapKitFixedWindowRateLimit,
  mapKitTokenResponseFromEnv,
} from '../src/server/worker.js'
import { createMapKitFixedWindowRateLimit as fromServer } from '../src/server/index.js'
import { createMapKitFixedWindowRateLimit as fromNuxtRuntime } from '../src/nuxt/runtime/server/rate-limit.js'
import { createTestPrivateKeyPem } from './test-keys.js'

const ROUTE = 'https://maps.example.test/api/mapkit-token'

function request(clientIp: string): Request {
  return new Request(ROUTE, {
    headers: { 'cf-connecting-ip': clientIp, 'sec-fetch-site': 'same-origin' },
  })
}

async function env() {
  return {
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: await createTestPrivateKeyPem(),
    APPLE_TEAM_ID: 'TEAM123456',
  }
}

describe('the §e.4 limiter on the Worker entry point (narduk-libs#485)', () => {
  afterEach(() => {
    clearMapKitTokenCacheForTests()
  })

  it('is one implementation, whichever entry point a caller imports it from', () => {
    expect(fromServer).toBe(createMapKitFixedWindowRateLimit)
    expect(fromNuxtRuntime).toBe(createMapKitFixedWindowRateLimit)
  })

  it('answers 429 with retry-after once a Worker caller spends the ceiling', async () => {
    const rateLimit = createMapKitFixedWindowRateLimit({ limit: 1, windowSeconds: 60 })
    const bindings = await env()

    const first = await mapKitTokenResponseFromEnv(
      request('198.51.100.1'),
      bindings,
      {},
      { rateLimit },
    )
    const second = await mapKitTokenResponseFromEnv(
      request('198.51.100.1'),
      bindings,
      {},
      { rateLimit },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('keys per client when the caller says how to name one', async () => {
    // Keyed on `self` (the default), every visitor to one host shares a single window. A Worker
    // knows the client address; `key` lets the ceiling be per client, as §e.4 specifies.
    const rateLimit = createMapKitFixedWindowRateLimit({
      key: ({ request: incoming, self }) => incoming.headers.get('cf-connecting-ip') ?? self,
      limit: 1,
      windowSeconds: 60,
    })
    const bindings = await env()

    await mapKitTokenResponseFromEnv(request('198.51.100.1'), bindings, {}, { rateLimit })
    const otherClient = await mapKitTokenResponseFromEnv(
      request('198.51.100.2'),
      bindings,
      {},
      { rateLimit },
    )
    const sameClient = await mapKitTokenResponseFromEnv(
      request('198.51.100.1'),
      bindings,
      {},
      { rateLimit },
    )

    expect(otherClient.status).toBe(200)
    expect(sameClient.status).toBe(429)
  })

  it('still keys on the routed origin by default', () => {
    let now = 0
    const limit = createMapKitFixedWindowRateLimit({ limit: 1, now: () => now, windowSeconds: 60 })
    const context = (clientIp: string) => ({
      origin: 'https://maps.example.test',
      request: request(clientIp),
      self: 'https://maps.example.test',
    })
    limit(context('198.51.100.1'))
    expect(limit(context('198.51.100.2'))).toMatchObject({ allowed: false })
    now = 60_000
    expect(limit(context('198.51.100.2'))).toStrictEqual({ allowed: true })
  })

  it('leaves the helper unlimited when the caller passes no limiter (default unchanged)', async () => {
    const bindings = await env()
    const statuses: number[] = []
    for (let index = 0; index < 40; index += 1) {
      statuses.push((await mapKitTokenResponseFromEnv(request('198.51.100.1'), bindings)).status)
    }
    expect(new Set(statuses)).toEqual(new Set([200]))
  })
})
