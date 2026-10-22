import { createServer } from 'node:http'

import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { enforceRateLimitPolicy, RATE_LIMIT_POLICIES } from '../runtime/server/utils/rateLimit'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))

async function serve(
  setup: (event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]) => void,
  policy = RATE_LIMIT_POLICIES.authLogin,
) {
  const app = createApp().use(
    defineEventHandler(async (event) => {
      setup(event)
      await enforceRateLimitPolicy(event, policy)
      return 'ok'
    }),
  )
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  return {
    get: (headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${address.port}/`, { headers }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('ponytail-5 auth rate limiter (core-runtime #2 / core-tests #5)', () => {
  it('does not let a rotating X-Forwarded-For defeat the cap (no cf-connecting-ip)', async () => {
    const s = await serve(() => {})
    try {
      const statuses: number[] = []
      for (let i = 0; i < 70; i++) {
        statuses.push((await s.get({ 'x-forwarded-for': `10.1.${i}.1, 1.1.1.1` })).status)
      }
      expect(statuses).toContain(429)
    } finally {
      await s.close()
    }
  })

  it('keys on cf-connecting-ip on Cloudflare, whatever X-Forwarded-For says', async () => {
    const s = await serve(() => {})
    try {
      const statuses: number[] = []
      for (let i = 0; i < 61; i++) {
        const headers = { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': `10.2.${i}.1` }
        statuses.push((await s.get(headers)).status)
      }
      expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true)
      expect(statuses[60]).toBe(429)
      expect((await s.get({ 'cf-connecting-ip': '198.51.100.8' })).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  it('keeps serving when the Cloudflare rate-limit binding throws', async () => {
    const s = await serve((event) => {
      ;(event.context as Record<string, unknown>).cloudflare = {
        env: {
          RL_60: {
            limit: () => {
              throw new Error('binding unavailable')
            },
          },
        },
      }
    })
    try {
      expect((await s.get({ 'cf-connecting-ip': '203.0.113.9' })).status).toBe(200)
    } finally {
      await s.close()
    }
  })
})
