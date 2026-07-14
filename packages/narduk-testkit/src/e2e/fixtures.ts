import { test as base, expect } from '@playwright/test'

import type { Browser, Page } from '@playwright/test'

const HYDRATION_PATTERNS = [
  /hydration/i,
  /mismatch/i,
  /hydration node mismatch/i,
  /data-server-rendered/i,
]

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const consoleLogs: string[] = []

    page.on('console', (msg) => {
      consoleLogs.push(msg.text())
    })

    await use(page)

    const hydrationErrors = consoleLogs.filter((log) =>
      HYDRATION_PATTERNS.some((pattern) => pattern.test(log)),
    )
    if (hydrationErrors.length > 0) {
      throw new Error(`Hydration errors detected in console:\n${hydrationErrors.join('\n')}`)
    }
  },
})

export async function waitForHydration(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('load')
}

function isBaseUrlReadyResponse(res: Response): boolean {
  return res.ok || (res.status >= 300 && res.status < 400)
}

export async function waitForBaseUrlReady(baseUrl: string, timeoutMs = 60_000) {
  const PROBE_TIMEOUT_MS = 5_000
  const deadline = Date.now() + timeoutMs

  // Issue a single method probe against `baseUrl` with its own AbortController
  // so HEAD failures/timeouts cannot cascade into the GET fallback. Returns
  // `true` when the server looks ready (2xx or 3xx), `false` on any
  // non-ready status or caught error.
  async function probe(method: 'HEAD' | 'GET', probeTimeout: number): Promise<boolean> {
    if (probeTimeout <= 0) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), probeTimeout)
    try {
      const response = await fetch(baseUrl, {
        method,
        signal: controller.signal,
        redirect: 'manual',
      })
      const ready = isBaseUrlReadyResponse(response)
      await response.body?.cancel().catch(() => {})
      return ready
    } catch {
      // Server still starting, method not supported (e.g. HEAD returning a
      // network-level error on some dev servers), or probe timed out. Caller
      // will retry or fall through to the other verb.
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break

    const headReady = await probe('HEAD', Math.min(PROBE_TIMEOUT_MS, remaining))
    if (headReady) return

    const afterHead = deadline - Date.now()
    if (afterHead <= 0) break
    const getReady = await probe('GET', Math.min(PROBE_TIMEOUT_MS, afterHead))
    if (getReady) return

    // Back off 1s, but never sleep past the overall deadline.
    const sleepRemaining = deadline - Date.now()
    if (sleepRemaining <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, sleepRemaining)))
  }

  throw new Error(`Server at ${baseUrl} did not become ready within ${timeoutMs}ms`)
}

export async function warmUpApp(browser: Browser, baseUrl: string, path = '/') {
  const page = await browser.newPage()

  try {
    await page.goto(new URL(path, baseUrl).toString(), { timeout: 60_000 })
    await page.waitForLoadState('load', { timeout: 20_000 })
  } finally {
    await page.close()
  }
}

export function createUniqueEmail(prefix = 'e2e') {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `${prefix}-${suffix}@example.com`
}

// ─── API Helpers ────────────────────────────────────────────
// Reusable helpers for E2E tests. All run inside page.evaluate()
// so they use the browser's cookie jar (session cookies).

/**
 * CSRF header required by the shared app's CSRF middleware.
 *
 * Shared base used by both `createTestFetchHeaders` (read-only requests) and
 * `createTestMutationHeaders` (JSON-body mutations) so there is a single
 * source of truth for the CSRF contract.
 */
const CSRF_HEADERS = {
  'X-Requested-With': 'XMLHttpRequest',
} as const

/**
 * Build the header bag for an E2E `fetch(...)` call that only needs CSRF
 * (`X-Requested-With: XMLHttpRequest`). Use this for reads or for mutations
 * whose body you set yourself without JSON content.
 *
 * This mirrors what `useCsrfFetch()` does at runtime, but for Playwright's
 * `page.evaluate()` context where Nuxt composables aren't available.
 *
 * ```ts
 * const headers = createTestFetchHeaders()
 * await page.evaluate(async (h) => {
 *   const res = await fetch('/api/auth/me', { headers: h })
 *   return res.json()
 * }, headers)
 * ```
 */
export function createTestFetchHeaders(extraHeaders: Record<string, string> = {}) {
  return {
    ...CSRF_HEADERS,
    ...extraHeaders,
  } as const
}

/**
 * Build the header bag for a JSON-body mutation request (CSRF + content-type).
 *
 * ```ts
 * const headers = createTestMutationHeaders()
 * await page.evaluate(async ({ headers, body }) => {
 *   await fetch('/api/items', { method: 'POST', headers, body: JSON.stringify(body) })
 * }, { headers, body: { name: 'example' } })
 * ```
 */
export function createTestMutationHeaders(extraHeaders: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    ...CSRF_HEADERS,
    ...extraHeaders,
  } as const
}

/**
 * Register a new user via the API and return the user object.
 * The page's cookie jar will contain the session after this call.
 */
export async function registerAndLogin(
  page: Page,
  payload: { email: string; name: string; password: string },
) {
  return page.evaluate(async (body) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, payload)
}

/**
 * Log in as the seeded admin user (admin@example.com / testpass123).
 */
export async function loginAsAdmin(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'testpass123' }),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  })
}

/**
 * Log in with specific credentials.
 */
export async function loginViaApi(page: Page, payload: { email: string; password: string }) {
  return page.evaluate(async (body) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, payload)
}

/**
 * Log out the current user.
 */
export async function logoutViaApi(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  })
}

/**
 * Create a notification via the shared notifications API.
 * Requires an authenticated user session. Non-admin users may only target
 * their own `userId`.
 */
export async function createNotificationViaApi(
  page: Page,
  payload: {
    actionUrl?: string
    body: string
    icon?: string
    kind: string
    title: string
    userId: string
  },
) {
  return page.evaluate(async (body) => {
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, payload)
}

/**
 * Fetch notifications for the currently authenticated user.
 */
export async function fetchNotificationsViaApi(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/notifications')
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  })
}

/**
 * Fetch unread notification count for the currently authenticated user.
 */
export async function fetchUnreadCountViaApi(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/api/notifications/unread-count')
    if (!response.ok) throw new Error(await response.text())
    const data = await response.json()
    return data.count
  })
}

/**
 * Mark all notifications as read for the currently authenticated user.
 */
export async function markAllNotificationsReadViaApi(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  })
}

/**
 * Update the current user's profile name.
 */
export async function updateProfileViaApi(page: Page, payload: { name: string }) {
  return page.evaluate(async (body) => {
    const response = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, payload)
}

export { expect }
