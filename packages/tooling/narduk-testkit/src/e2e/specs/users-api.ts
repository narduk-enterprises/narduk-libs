import {
  expect,
  loginAsAdmin,
  registerAndLogin,
  test,
  waitForBaseUrlReady,
  warmUpApp,
} from '../fixtures.js'

import type { Page } from '@playwright/test'

/**
 * The shared list-query contract's response (narduk-libs#257): `items` +
 * `offset`, not `users` + `page`.
 */
interface UsersApiResponse {
  items: Array<{
    createdAt: string
    email: string
    id: string
    isAdmin: boolean
    name: string | null
  }>
  limit: number
  offset: number
  q: string | null
  sort: string | null
  total: number | null
}

interface UserPayload {
  ok: boolean
  payload: UsersApiResponse | null
  status: number
}

export interface UsersApiSpecOptions {
  apiPath?: string
  basePath?: string
  describeName?: string
}

async function requestUsers(page: Page, query = '', path = '/api/admin/users') {
  return page.evaluate(async (path: string) => {
    const response = await fetch(path)
    const text = await response.text()

    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    return {
      status: response.status,
      ok: response.ok,
      payload,
    } as UserPayload
  }, `${path}${query}`)
}

function assertUsersApiPayload(payload: UsersApiResponse | null): UsersApiResponse {
  if (!payload) {
    throw new Error('Expected users API payload but got non-JSON response.')
  }

  return payload
}

/**
 * Register the shared users API Playwright spec against the current Playwright
 * test runner. This module is a pure factory: it never invokes itself on
 * import, so consumers always call `registerUsersApiSpec()` exactly once from
 * their own local spec file.
 *
 * Usage in a downstream app:
 *   // tests/e2e/users-api.spec.ts
 *   import { registerUsersApiSpec } from '@narduk-enterprises/narduk-testkit/e2e/specs/users-api'
 *   registerUsersApiSpec()
 */
export function registerUsersApiSpec(options: UsersApiSpecOptions = {}) {
  const { apiPath = '/api/admin/users', describeName = 'users API', basePath = '/' } = options

  test.describe(describeName, () => {
    test.beforeAll(async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error('web users API tests require baseURL to be configured.')
      }

      await waitForBaseUrlReady(baseURL)
      await warmUpApp(browser, baseURL, basePath)
    })

    test.beforeEach(async ({ page }) => {
      // Playwright pages start at `about:blank`. Navigate to the app origin
      // so the relative users API requests below resolve against the
      // test `baseURL` instead of throwing URL-parse errors.
      await page.goto(basePath)
    })

    test('rejects unauthenticated callers', async ({ page }) => {
      const response = await requestUsers(page, '', apiPath)

      expect(response.status).toBe(401)
      expect(response.ok).toBe(false)
    })

    test('rejects authenticated non-admin callers', async ({ page }) => {
      const email = `user-${Date.now()}@example.com`
      await registerAndLogin(page, { name: 'Non-admin User', email, password: 'password123' })

      const response = await requestUsers(page, '', apiPath)

      expect(response.status).toBe(403)
      expect(response.ok).toBe(false)
    })

    test('returns paged rows to admins and omits sensitive fields', async ({ page }) => {
      await loginAsAdmin(page)
      const response = await requestUsers(page, '?offset=0&limit=2', apiPath)
      const payload = assertUsersApiPayload(response.payload)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
      expect(payload).not.toBeNull()

      expect(payload).toMatchObject({
        items: expect.any(Array),
        limit: 2,
        offset: 0,
        sort: 'createdAt:desc',
        total: expect.any(Number),
      })

      for (const user of payload.items) {
        expect(user).toMatchObject({
          id: expect.any(String),
          email: expect.any(String),
          isAdmin: expect.any(Boolean),
          createdAt: expect.any(String),
        })
        expect(user).toHaveProperty('name')
        expect(user).not.toHaveProperty('passwordHash')
      }
    })

    test('keeps the legacy users API alias compatible', async ({ page }) => {
      await loginAsAdmin(page)
      const response = await requestUsers(page, '?offset=0&limit=1', '/api/users')
      const payload = assertUsersApiPayload(response.payload)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
      expect(payload).toMatchObject({
        items: expect.any(Array),
        limit: 1,
        offset: 0,
        total: expect.any(Number),
      })
    })

    test('validates pagination inputs against the list-query contract', async ({ page }) => {
      await loginAsAdmin(page)

      // `page` is not a key of the contract: rejected, not silently ignored.
      const unknownKey = await requestUsers(page, '?page=1&limit=2', apiPath)
      expect(unknownKey.status).toBe(400)

      const negativeOffset = await requestUsers(page, '?offset=-1&limit=2', apiPath)
      expect(negativeOffset.status).toBe(400)

      const fractionalOffset = await requestUsers(page, '?offset=1.5&limit=2', apiPath)
      expect(fractionalOffset.status).toBe(400)

      const fractionalLimit = await requestUsers(page, '?offset=0&limit=2.7', apiPath)
      expect(fractionalLimit.status).toBe(400)

      const unknownSort = await requestUsers(page, '?sort=passwordHash:asc', apiPath)
      expect(unknownSort.status).toBe(400)

      // An over-large limit is clamped to the route ceiling, not rejected.
      const clamped = await requestUsers(page, '?limit=9999', apiPath)
      expect(clamped.status).toBe(200)
      expect(assertUsersApiPayload(clamped.payload).limit).toBe(100)

      const defaults = await requestUsers(page, '', apiPath)
      const payload = assertUsersApiPayload(defaults.payload)

      expect(defaults.status).toBe(200)
      expect(payload.offset).toBe(0)
      expect(payload.limit).toBe(20)
    })
  })
}
