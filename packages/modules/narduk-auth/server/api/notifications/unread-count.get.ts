/**
 * GET /api/notifications/unread-count
 *
 * Lightweight endpoint that returns only the unread notification count.
 * Designed for polling from the frontend badge.
 */
import { defineEventHandler } from 'h3'

import { requireAuth, requireAuthScopes } from '#layer/server/utils/auth'
import { AUTH_NOTIFICATION_SCOPES, getUnreadCount } from '#narduk-auth-server/utils/notifications'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  // A session passes; an API key needs `auth:notifications:read` (or `*`).
  requireAuthScopes(user, [AUTH_NOTIFICATION_SCOPES.read])
  const count = await getUnreadCount(event, user.id)

  return { count }
})
