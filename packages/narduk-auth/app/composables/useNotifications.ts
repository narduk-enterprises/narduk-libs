/* eslint-disable narduk/file-size-budget -- Notifications composable owns the in-app + browser push integration (permission, subscription, list, mark-read) as one unit to prevent state-sync drift between pieces. */
/**
 * Composable for in-app + browser push notifications.
 *
 * Provides reactive notification state, polling for unread count,
 * and Web Notifications API integration for browser push.
 */

/** Notification shape returned from the API. */
export interface AppNotification {
  actionUrl: string | null
  body: string
  createdAt: string
  icon: string | null
  id: string
  isRead: boolean
  kind: string
  readAt: string | null
  resourceId: string | null
  resourceType: string | null
  title: string
  userId: string
}

const POLL_INTERVAL_MS = 60_000

export function useNotifications() {
  const items = useState<AppNotification[]>('layer-notifications', () => [])
  const unreadCount = useState<number>('layer-notifications-unread', () => 0)
  const loading = useState<boolean>('layer-notifications-loading', () => false)
  const lastFetchedCount = useState<number>('layer-notifications-last-count', () => 0)

  // Browser push notification state (client-only)
  const pushSupported = useState<boolean>('layer-push-supported', () => false)
  const pushPermission = useState<string>('layer-push-permission', () => 'default')

  let pollTimer: ReturnType<typeof setInterval> | null = null

  /** Fetch the unread count (lightweight). */
  async function refreshUnreadCount() {
    try {
      const data = await $fetch<{ count: number }>('/api/notifications/unread-count')
      const previousCount = unreadCount.value
      unreadCount.value = data.count

      // Fire browser notification if new unread items appeared
      if (
        import.meta.client &&
        pushPermission.value === 'granted' &&
        data.count > previousCount &&
        previousCount === lastFetchedCount.value
      ) {
        sendBrowserNotification(
          'New notification',
          `You have ${data.count} unread notification${data.count > 1 ? 's' : ''}.`,
        )
      }

      lastFetchedCount.value = data.count
    } catch {
      // Silently ignore — user may not be authenticated
    }
  }

  /** Fetch the full notification list. */
  async function refresh() {
    loading.value = true
    try {
      const data = await $fetch<{ notifications: AppNotification[] }>('/api/notifications')
      items.value = data.notifications
      unreadCount.value = data.notifications.filter((n) => !n.isRead).length
    } catch {
      // Silently ignore
    } finally {
      loading.value = false
    }
  }

  /** Mark a single notification as read. */
  async function markAsRead(id: string) {
    await $fetch(`/api/notifications/${id}`, { method: 'PATCH' })
    const item = items.value.find((n) => n.id === id)
    if (item && !item.isRead) {
      item.isRead = true
      item.readAt = new Date().toISOString()
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
  }

  /** Mark all notifications as read. */
  async function markAllAsRead() {
    await $fetch('/api/notifications/read-all', { method: 'POST' })
    for (const item of items.value) {
      if (!item.isRead) {
        item.isRead = true
        item.readAt = new Date().toISOString()
      }
    }
    unreadCount.value = 0
  }

  /** Delete a notification. */
  async function remove(id: string) {
    await $fetch(`/api/notifications/${id}`, { method: 'DELETE' })
    const wasUnread = items.value.find((n) => n.id === id && !n.isRead)
    items.value = items.value.filter((n) => n.id !== id)
    if (wasUnread) {
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
  }

  /** Request browser notification permission. */
  async function requestPushPermission(): Promise<string> {
    if (!import.meta.client || !('Notification' in window)) {
      return 'denied'
    }

    const result = await window.Notification.requestPermission()
    pushPermission.value = result
    return result
  }

  /** Fire a browser notification (client-only). */
  function sendBrowserNotification(title: string, body: string, options?: NotificationOptions) {
    if (!import.meta.client || pushPermission.value !== 'granted') return

    try {
      const notification = new window.Notification(title, {
        body,
        icon: '/favicon-32x32.png',
        badge: '/favicon-32x32.png',
        ...options,
      })

      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    } catch {
      // Notification constructor can fail in some environments
    }
  }

  /** Start polling for unread count. Call once from a layout or app.vue. */
  function startPolling() {
    if (!import.meta.client) return

    // Initialize browser notification state
    if ('Notification' in window) {
      pushSupported.value = true
      pushPermission.value = window.Notification.permission
    }

    // Initial fetch
    void refreshUnreadCount()

    // Poll at interval, but only when tab is visible
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(() => {
      if (!document.hidden) {
        void refreshUnreadCount()
      }
    }, POLL_INTERVAL_MS)
  }

  /** Stop polling. */
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return {
    // In-app state
    notifications: items,
    unreadCount,
    loading,
    refresh,
    markAsRead,
    markAllAsRead,
    remove,

    // Browser push
    pushSupported,
    pushPermission,
    requestPushPermission,
    sendBrowserNotification,

    // Polling lifecycle
    startPolling,
    stopPolling,
  }
}
