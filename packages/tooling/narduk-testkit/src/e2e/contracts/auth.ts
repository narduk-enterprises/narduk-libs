import {
  createUniqueEmail,
  expect,
  test,
  waitForBaseUrlReady,
  waitForHydration,
  warmUpApp,
} from '../fixtures.js'

import type { Page } from '@playwright/test'

interface SharedAuthContractOptions {
  appName?: string
  basePath?: string
  dashboardHeading?: RegExp
  loginHeading?: RegExp
  loginPath?: string
  protectedPath?: string
  registerHeading?: RegExp
  registerPath?: string
}

/**
 * Resolve an absolute route path against the contract's `basePath` so apps
 * hosted under a sub-path (e.g. `basePath: '/app'`) navigate to the correct
 * URL. Idempotent: paths that are already prefixed with `basePath` are
 * returned unchanged, so callers can keep passing either `/login` or
 * `/app/login` without the contract double-prefixing them.
 */
function resolveContractPath(basePath: string, path: string): string {
  if (!path.startsWith('/')) return path
  const base = basePath === '/' ? '' : basePath.replace(/\/+$/, '')
  if (!base) return path
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path}`
}

export function defineSharedAuthContract(options: SharedAuthContractOptions = {}) {
  const {
    appName = 'app',
    basePath = '/',
    loginPath = '/login',
    registerPath = '/register',
    protectedPath = '/dashboard/',
    dashboardHeading = /Welcome/i,
    loginHeading = /Welcome back/i,
    registerHeading = /Create an account/i,
  } = options

  const resolvedLoginPath = resolveContractPath(basePath, loginPath)
  const resolvedRegisterPath = resolveContractPath(basePath, registerPath)
  const resolvedProtectedPath = resolveContractPath(basePath, protectedPath)

  test.describe(`${appName} shared auth contract`, () => {
    async function registerViaApi(
      page: Page,
      payload: { email: string; name: string; password: string },
    ) {
      return page.evaluate(async (body) => {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          throw new Error(await response.text())
        }

        return response.json()
      }, payload)
    }

    async function loginViaApi(page: Page, payload: { email: string; password: string }) {
      return page.evaluate(async (body) => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          throw new Error(await response.text())
        }

        return response.json()
      }, payload)
    }

    async function logoutViaApi(page: Page) {
      return page.evaluate(async () => {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
          },
        })

        if (!response.ok) {
          throw new Error(await response.text())
        }

        return response.json()
      })
    }

    test.beforeAll(async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error('Shared auth contract requires Playwright baseURL to be configured.')
      }

      await waitForBaseUrlReady(baseURL)
      await warmUpApp(browser, baseURL, basePath)
    })

    test('login and register pages render', async ({ page }) => {
      await page.goto(resolvedLoginPath)
      await expect(page.getByRole('heading', { name: loginHeading })).toBeVisible()

      await page.goto(resolvedRegisterPath)
      await expect(page.getByRole('heading', { name: registerHeading })).toBeVisible()
    })

    test('guest-only footer links navigate between login and register', async ({ page }) => {
      await page.goto(resolvedLoginPath)
      await waitForHydration(page)
      await page.getByRole('link', { name: 'Sign up' }).click()
      await expect(page).toHaveURL(new RegExp(resolvedRegisterPath))

      await waitForHydration(page)
      await page.getByRole('link', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(new RegExp(resolvedLoginPath))
    })

    test('unauthenticated user is redirected from protected route', async ({ page }) => {
      await page.goto(resolvedProtectedPath)
      await expect(page).toHaveURL(new RegExp(resolvedLoginPath), { timeout: 10_000 })
      await expect(page.getByRole('heading', { name: loginHeading })).toBeVisible()
    })

    test('register, logout, and login flow works', async ({ page }) => {
      const email = createUniqueEmail(appName.replaceAll(/\s+/g, '-').toLowerCase())
      const password = 'password123'

      await page.goto(resolvedRegisterPath)
      await waitForHydration(page)
      await registerViaApi(page, { name: 'E2E User', email, password })

      await page.goto(resolvedProtectedPath)
      await expect(page).toHaveURL(new RegExp(resolvedProtectedPath), { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: dashboardHeading })).toBeVisible()

      await logoutViaApi(page)
      await page.goto(resolvedLoginPath)
      await expect(page).toHaveURL(new RegExp(resolvedLoginPath), { timeout: 10_000 })
      await expect(page.getByRole('heading', { name: loginHeading })).toBeVisible()

      await loginViaApi(page, { email, password })

      await page.goto(resolvedProtectedPath)
      await expect(page).toHaveURL(new RegExp(resolvedProtectedPath), { timeout: 15_000 })
      await expect(page.getByRole('heading', { name: dashboardHeading })).toBeVisible()
    })

    test('local HTTP auth login omits the Secure session-cookie flag', async ({
      page,
      baseURL,
    }) => {
      // Skipped on https previews: Set-Cookie Secure semantics only asserted for http:// dev.
      test.skip(!baseURL?.startsWith('http://'), 'This check only applies to local HTTP dev.')

      const email = createUniqueEmail(`${appName.replaceAll(/\s+/g, '-').toLowerCase()}-cookie`)
      const password = 'password123'

      await page.goto(resolvedRegisterPath)
      await waitForHydration(page)
      await registerViaApi(page, { name: 'Cookie User', email, password })
      await logoutViaApi(page)

      const loginResponsePromise = page.waitForResponse((response) => {
        return (
          new URL(response.url()).pathname === '/api/auth/login' &&
          response.request().method() === 'POST'
        )
      })

      await loginViaApi(page, { email, password })

      const loginResponse = await loginResponsePromise
      const setCookie = (await loginResponse.allHeaders())['set-cookie'] ?? ''

      expect(setCookie).toContain('nuxt-session=')
      expect(setCookie).toContain('SameSite=Lax')
      expect(setCookie).not.toContain('Secure')
    })

    test('authenticated users are redirected away from guest pages', async ({ page }) => {
      const email = createUniqueEmail(`${appName.replaceAll(/\s+/g, '-').toLowerCase()}-redirect`)

      await page.goto(resolvedRegisterPath)
      await waitForHydration(page)
      await registerViaApi(page, { name: 'Redirect User', email, password: 'password123' })

      await page.goto(resolvedProtectedPath)
      await expect(page).toHaveURL(new RegExp(resolvedProtectedPath), { timeout: 15_000 })

      await page.goto(resolvedLoginPath)
      await expect(page).toHaveURL(new RegExp(resolvedProtectedPath), { timeout: 10_000 })

      await page.goto(resolvedRegisterPath)
      await expect(page).toHaveURL(new RegExp(resolvedProtectedPath), { timeout: 10_000 })
    })

    test('stale session cookie still allows login page to render', async ({
      page,
      context,
      baseURL,
    }) => {
      // Derive the cookie domain from the runtime `baseURL` so the stub
      // cookie actually attaches when Playwright runs against hosts other
      // than `localhost` (e.g. `127.0.0.1` or a preview URL). Hard-coding
      // `localhost` silently makes the scenario a no-op on those hosts.
      const host = new URL(baseURL ?? 'http://localhost').hostname
      await context.addCookies([
        {
          name: 'nuxt-session',
          value: 'stale-invalid-token-value',
          domain: host,
          path: '/',
        },
      ])

      await page.goto(resolvedLoginPath)
      await expect(page).toHaveURL(new RegExp(resolvedLoginPath), { timeout: 10_000 })
      await expect(page.getByRole('heading', { name: loginHeading })).toBeVisible()
    })

    test('stale session cookie on protected route redirects to login', async ({
      page,
      context,
      baseURL,
    }) => {
      const host = new URL(baseURL ?? 'http://localhost').hostname
      await context.addCookies([
        {
          name: 'nuxt-session',
          value: 'stale-invalid-token-value',
          domain: host,
          path: '/',
        },
      ])

      await page.goto(resolvedProtectedPath)
      await expect(page).toHaveURL(new RegExp(resolvedLoginPath), { timeout: 10_000 })
    })
  })
}
