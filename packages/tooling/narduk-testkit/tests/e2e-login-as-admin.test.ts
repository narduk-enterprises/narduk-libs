import { afterEach, describe, expect, it, vi } from 'vitest'

import { loginAsAdmin } from '../src/e2e/fixtures.js'

import type { Page } from '@playwright/test'

function fakePage() {
  const bodies: unknown[] = []
  const page = {
    evaluate: vi.fn(async (_fn: unknown, body: unknown) => {
      bodies.push(body)
      return { ok: true }
    }),
  } as unknown as Page
  return { page, bodies }
}

describe('loginAsAdmin', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('has no built-in password: it refuses to run without one', async () => {
    vi.stubEnv('E2E_ADMIN_PASSWORD', '')
    const { page, bodies } = fakePage()
    await expect(loginAsAdmin(page)).rejects.toThrow('E2E_ADMIN_PASSWORD')
    expect(bodies).toEqual([])
  })

  it('logs in with the password from the environment and the default email', async () => {
    vi.stubEnv('E2E_ADMIN_PASSWORD', 'from-env')
    vi.stubEnv('E2E_ADMIN_EMAIL', '')
    const { page, bodies } = fakePage()
    await loginAsAdmin(page)
    expect(bodies).toEqual([{ email: 'admin@example.com', password: 'from-env' }])
  })

  it('prefers explicit credentials over the environment', async () => {
    vi.stubEnv('E2E_ADMIN_PASSWORD', 'from-env')
    vi.stubEnv('E2E_ADMIN_EMAIL', 'env@example.com')
    const { page, bodies } = fakePage()
    await loginAsAdmin(page, { email: 'me@example.com', password: 'explicit' })
    expect(bodies).toEqual([{ email: 'me@example.com', password: 'explicit' }])
  })
})
