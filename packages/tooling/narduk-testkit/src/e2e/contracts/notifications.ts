import {
  createNotificationViaApi,
  createUniqueEmail,
  expect,
  fetchNotificationsViaApi,
  fetchUnreadCountViaApi,
  markAllNotificationsReadViaApi,
  registerAndLogin,
  test,
  waitForBaseUrlReady,
  waitForVueHydrated,
  warmUpApp,
} from '../fixtures.js'

import type { Page } from '@playwright/test'

/**
 * Shared notification API contract.
 *
 * Tests the /api/notifications/* endpoints provided by the shared auth package.
 * Apps invoke this with minimal config to verify they inherit working
 * notification routes.
 *
 * Usage:
 *   import { defineSharedNotificationsContract } from '@narduk-enterprises/narduk-testkit/e2e/contracts/notifications'
 *   defineSharedNotificationsContract({ appName: 'myapp' })
 */

interface SharedNotificationsContractOptions {
  appName?: string
  basePath?: string
}

interface ExpectedNotification {
  actionUrl: string
  body: string
  id: string
  isRead: boolean
  kind: string
  title: string
  userId: string
}

function getSessionUserId(result: unknown): string {
  if (
    !result ||
    typeof result !== 'object' ||
    !('user' in result) ||
    !result.user ||
    typeof result.user !== 'object' ||
    !('id' in result.user) ||
    typeof result.user.id !== 'string'
  ) {
    throw new Error('Expected registerAndLogin() to return an authenticated user id.')
  }

  return result.user.id
}

function getCreatedNotificationId(result: unknown): string {
  if (
    !result ||
    typeof result !== 'object' ||
    !('id' in result) ||
    typeof result.id !== 'string' ||
    result.id.length === 0
  ) {
    throw new Error('Expected createNotificationViaApi() to return a notification id.')
  }

  return result.id
}

function expectNotificationList(data: unknown): Array<Record<string, unknown>> {
  // Contract shape plus the deprecated `notifications` alias (narduk-libs#257).
  expect(data).toEqual(
    expect.objectContaining({
      items: expect.any(Array),
      notifications: expect.any(Array),
    }),
  )

  const body = data as {
    items: Array<Record<string, unknown>>
    notifications: Array<Record<string, unknown>>
  }
  expect(body.notifications).toEqual(body.items)

  return body.items
}

function expectIsoTimestamp(value: unknown) {
  expect(typeof value).toBe('string')
  expect(value).not.toBe('')
  expect(Number.isNaN(Date.parse(value as string))).toBe(false)
}

function expectNotificationShape(notification: unknown, expected: ExpectedNotification) {
  expect(notification).toEqual(
    expect.objectContaining({
      actionUrl: expected.actionUrl,
      body: expected.body,
      id: expected.id,
      isRead: expected.isRead,
      kind: expected.kind,
      title: expected.title,
      userId: expected.userId,
    }),
  )

  const row = notification as Record<string, unknown>
  expectIsoTimestamp(row.createdAt)

  if (expected.isRead) {
    expectIsoTimestamp(row.readAt)
  } else {
    expect(row.readAt).toBeNull()
  }
}

export function defineSharedNotificationsContract(
  options: SharedNotificationsContractOptions = {},
) {
  const { appName = 'app', basePath = '/' } = options

  test.describe(`${appName} shared notifications contract`, () => {
    test.describe.configure({ mode: 'serial' })

    async function createUnreadNotificationFixture(page: Page): Promise<ExpectedNotification> {
      const email = createUniqueEmail(`${appName}-notif`)
      const result = await registerAndLogin(page, {
        name: 'Notif User',
        email,
        password: 'password123',
      })
      const userId = getSessionUserId(result)
      const title = `${appName} notification`
      const body = 'Shared notification contract fixture.'
      const actionUrl = '/dashboard'

      const notification = await createNotificationViaApi(page, {
        userId,
        kind: 'system',
        title,
        body,
        actionUrl,
      })

      return {
        actionUrl,
        body,
        id: getCreatedNotificationId(notification),
        isRead: false,
        kind: 'system',
        title,
        userId,
      }
    }

    test.beforeAll(async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error('Shared notifications contract requires Playwright baseURL.')
      }
      await waitForBaseUrlReady(baseURL)
      await warmUpApp(browser, baseURL, basePath)
    })

    test('GET /api/notifications requires authentication', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const status = await page.evaluate(async () => {
        const response = await fetch('/api/notifications')
        return response.status
      })

      expect(status).toBe(401)
    })

    test('GET /api/notifications/unread-count requires authentication', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const status = await page.evaluate(async () => {
        const response = await fetch('/api/notifications/unread-count')
        return response.status
      })

      expect(status).toBe(401)
    })

    test('authenticated user can fetch notifications', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const expected = await createUnreadNotificationFixture(page)

      const data = await fetchNotificationsViaApi(page)
      const notifications = expectNotificationList(data)
      const notification = notifications.find((item) => item.id === expected.id)

      expect(notifications).toHaveLength(1)
      expectNotificationShape(notification, expected)
    })

    test('authenticated user can fetch unread count', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      await createUnreadNotificationFixture(page)

      const count = await fetchUnreadCountViaApi(page)

      expect(typeof count).toBe('number')
      expect(count).toBe(1)
    })

    test('created notifications are returned with the expected shape', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const expected = await createUnreadNotificationFixture(page)

      const count = await fetchUnreadCountViaApi(page)
      expect(count).toBe(1)

      const data = await fetchNotificationsViaApi(page)
      const notifications = expectNotificationList(data)
      const notification = notifications.find((item) => item.id === expected.id)

      expect(notifications).toHaveLength(1)
      expectNotificationShape(notification, expected)
    })

    test('mark-all-read clears unread count', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      await createUnreadNotificationFixture(page)

      const countBefore = await fetchUnreadCountViaApi(page)
      expect(countBefore).toBe(1)

      await markAllNotificationsReadViaApi(page)

      const countAfter = await fetchUnreadCountViaApi(page)
      expect(countAfter).toBe(0)
    })

    test('PATCH /api/notifications/:id marks single notification as read', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const expected = await createUnreadNotificationFixture(page)

      const countBefore = await fetchUnreadCountViaApi(page)
      expect(countBefore).toBe(1)

      const data = await fetchNotificationsViaApi(page)
      const notifications = expectNotificationList(data)
      const unread = notifications.find((n) => n.id === expected.id && n.isRead === false)

      expectNotificationShape(unread, expected)

      const response = await page.evaluate(async (id) => {
        const notificationId = String(id)
        const response = await fetch(`/api/notifications/${notificationId}`, {
          method: 'PATCH',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        return response.status
      }, unread!.id)

      expect(response).toBe(200)

      const countAfter = await fetchUnreadCountViaApi(page)
      expect(countAfter).toBe(countBefore - 1)

      const dataAfter = await fetchNotificationsViaApi(page)
      const notificationsAfter = expectNotificationList(dataAfter)
      const updated = notificationsAfter.find((n) => n.id === expected.id)

      expectNotificationShape(updated, { ...expected, isRead: true })
    })

    test('DELETE /api/notifications/:id requires authentication', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const status = await page.evaluate(async () => {
        const response = await fetch('/api/notifications/fake-id', {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        return response.status
      })

      expect(status).toBe(401)
    })

    test('POST /api/notifications/read-all requires authentication', async ({ page }) => {
      await page.goto(basePath)
      await waitForVueHydrated(page)

      const status = await page.evaluate(async () => {
        const response = await fetch('/api/notifications/read-all', {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        return response.status
      })

      expect(status).toBe(401)
    })
  })
}
