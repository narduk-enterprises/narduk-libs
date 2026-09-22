import {
  createUniqueEmail,
  expect,
  loginAsAdmin,
  logoutViaApi,
  registerAndLogin,
  test,
  updateProfileViaApi,
  waitForBaseUrlReady,
  waitForVueHydrated,
  warmUpApp,
} from '../fixtures.js'

const AUTH_ME_URL = '/api/auth/me'

/**
 * Shared user menu and profile contract.
 *
 * Tests user menu rendering, profile API, and settings page behavior.
 * Apps invoke this with minimal configuration.
 *
 * Usage:
 *   import { defineSharedUserProfileContract } from '@narduk-enterprises/narduk-testkit/e2e/contracts/user-profile'
 *   defineSharedUserProfileContract({
 *     appName: 'myapp',
 *     settingsPath: '/settings/api-keys',
 *   })
 */

interface SharedUserProfileContractOptions {
  appName?: string
  basePath?: string
  settingsPath?: string
}

interface ExpectedUserProfile {
  email: string
  isAdmin?: boolean | null
  name: string | null
}

function getAuthMeUser(data: unknown): Record<string, unknown> {
  expect(data).toEqual(expect.objectContaining({ user: expect.any(Object) }))

  const user = (data as { user: unknown }).user
  expect(user).not.toBeNull()

  return user as Record<string, unknown>
}

function expectAuthMeUser(data: unknown, expected: ExpectedUserProfile) {
  const user = getAuthMeUser(data)

  expect(typeof user.id).toBe('string')
  expect(user.id).not.toBe('')
  expect(user.email).toBe(expected.email)
  expect(user.name).toBe(expected.name)

  if ('isAdmin' in expected) {
    expect(user.isAdmin).toBe(expected.isAdmin)
  } else {
    expect([true, false, null]).toContain(user.isAdmin)
  }
}

/**
 * Resolve an absolute route path against `basePath` so apps hosted under a
 * sub-path (e.g. `basePath: '/app'`) still navigate correctly. Idempotent:
 * paths already prefixed with `basePath` are returned unchanged.
 */
function resolveContractPath(basePath: string, path: string): string {
  if (!path.startsWith('/')) return path
  const base = basePath === '/' ? '' : basePath.replace(/\/+$/, '')
  if (!base) return path
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path}`
}

export function defineSharedUserProfileContract(options: SharedUserProfileContractOptions = {}) {
  const { appName = 'app', basePath = '/', settingsPath = '/settings/api-keys' } = options

  const resolvedSettingsPath = resolveContractPath(basePath, settingsPath)

  test.describe(`${appName} shared user profile contract`, () => {
    test.beforeAll(async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error('Shared user profile contract requires Playwright baseURL.')
      }
      await waitForBaseUrlReady(baseURL)
      await warmUpApp(browser, baseURL, basePath)
    })

    // ─── Profile API Tests ──────────────────────────────────

    test('GET /api/auth/me returns null when unauthenticated', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const data = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)

      expect(data).toEqual(expect.objectContaining({ user: null }))
    })

    test('GET /api/auth/me returns user when authenticated', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const email = createUniqueEmail(`${appName}-me`)
      await registerAndLogin(page, { name: 'Profile User', email, password: 'password123' })

      const data = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)

      expect(data).toEqual(expect.objectContaining({ user: expect.objectContaining({ email }) }))
      expectAuthMeUser(data, { email, name: 'Profile User' })
    })

    test('PATCH /api/auth/me requires authentication', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const status = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ name: 'Hacker' }),
        })
        return response.status
      }, AUTH_ME_URL)

      expect(status).toBe(401)
    })

    test('PATCH /api/auth/me updates the user name', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const email = createUniqueEmail(`${appName}-update`)
      await registerAndLogin(page, { name: 'Old Name', email, password: 'password123' })

      const result = await updateProfileViaApi(page, { name: 'New Name' })
      expect(result).toEqual(expect.objectContaining({ ok: true }))

      // Verify the name was updated in the session
      const data = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)

      expectAuthMeUser(data, { email, name: 'New Name' })
    })

    test('PATCH /api/auth/me trims whitespace from name', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const email = createUniqueEmail(`${appName}-trim`)
      await registerAndLogin(page, { name: 'Trimmer', email, password: 'password123' })

      await updateProfileViaApi(page, { name: '  Trimmed Name  ' })

      const data = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)

      expect(data).toEqual(
        expect.objectContaining({ user: expect.objectContaining({ name: 'Trimmed Name' }) }),
      )
      expectAuthMeUser(data, { email, name: 'Trimmed Name' })
    })

    test('settings route exposes API token management for authenticated users', async ({
      page,
    }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const email = createUniqueEmail(`${appName}-settings`)
      await registerAndLogin(page, { name: 'Settings User', email, password: 'password123' })

      await page.goto(resolvedSettingsPath)
      await waitForVueHydrated(page)

      await expect(page.getByRole('heading', { name: /api tokens/i })).toBeVisible()
    })

    // ─── Logout Flow Tests ──────────────────────────────────

    test('logout clears session and redirects', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const email = createUniqueEmail(`${appName}-logout`)
      await registerAndLogin(page, { name: 'Logout User', email, password: 'password123' })

      // Verify authenticated
      const dataBefore = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)
      expectAuthMeUser(dataBefore, { email, name: 'Logout User' })

      // Logout
      await logoutViaApi(page)

      // Verify session is cleared
      const dataAfter = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)
      expect(dataAfter).toEqual(expect.objectContaining({ user: null }))
    })

    // ─── Admin User Tests ───────────────────────────────────

    test('admin user has isAdmin flag set', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      await loginAsAdmin(page)

      const data = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)

      expect(data).toEqual(
        expect.objectContaining({ user: expect.objectContaining({ isAdmin: true }) }),
      )
      expectAuthMeUser(data, { email: 'admin@example.com', name: 'Admin User', isAdmin: true })
    })

    test('normal user does not have isAdmin flag', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const email = createUniqueEmail(`${appName}-normal`)
      await registerAndLogin(page, { name: 'Normal User', email, password: 'password123' })

      const data = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return response.json()
      }, AUTH_ME_URL)

      expect(data).toEqual(
        expect.objectContaining({ user: expect.objectContaining({ isAdmin: false }) }),
      )
      expectAuthMeUser(data, { email, name: 'Normal User', isAdmin: false })
    })
  })
}

/**
 * @alias defineSharedUserProfileContract
 * @deprecated Use `defineSharedUserProfileContract` instead.
 */
export const useSharedUserProfileContract = defineSharedUserProfileContract
