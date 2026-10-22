/** The auth wrappers must reject before the handler (or body parser) runs. */
import { createApp, createError, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import {
  defineAdminMutation,
  defineCronMutation,
  defineUserMutation,
} from '../runtime/server/utils/mutation'

import type { EventHandler } from 'h3'

const deny = (statusCode: number) => () => {
  throw createError({ statusCode })
}
const requireAuth = vi.fn(deny(401))
const requireAdmin = vi.fn(deny(403))
const requireCronAuth = vi.fn(deny(401))

vi.mock('#layer/server/utils/auth', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...(args as [])),
  requireAuth: (...args: unknown[]) => requireAuth(...(args as [])),
  requireAuthScopes: (...args: unknown[]) => requireAuth(...(args as [])),
}))
vi.mock('#layer/server/utils/cron', () => ({
  requireCronAuth: (...args: unknown[]) => requireCronAuth(...(args as [])),
}))
vi.mock('#layer/server/utils/rateLimit', () => ({ enforceRateLimitPolicy: vi.fn() }))

const rateLimit = { namespace: 'test', maxRequests: 5, windowMs: 1000 }

describe('auth mutation wrappers', () => {
  it.each([
    ['defineUserMutation', defineUserMutation, 401],
    ['defineAdminMutation', defineAdminMutation, 403],
    ['defineCronMutation', defineCronMutation, 401],
  ] as const)('%s rejects before the handler', async (_name, define, status) => {
    const parseBody = vi.fn()
    const handler = vi.fn(() => 'ok')
    const web = toWebHandler(
      createApp().use(
        (define as (...args: unknown[]) => EventHandler)({ rateLimit, parseBody }, handler),
      ),
    )
    const res = await web(new Request('http://localhost/x', { method: 'POST' }))
    expect(res.status).toBe(status)
    expect(handler).not.toHaveBeenCalled()
    expect(parseBody).not.toHaveBeenCalled()
  })
})
