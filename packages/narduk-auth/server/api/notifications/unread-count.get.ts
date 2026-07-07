/**
 * GET /api/notifications/unread-count
 *
 * Lightweight endpoint that returns only the unread notification count.
 * Designed for polling from the frontend badge.
 */
import { defineEventHandler } from 'h3'

import { requireAuth } from '#layer/server/utils/auth'
import { getUnreadCount } from '#narduk-auth-server/utils/notifications'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const count = await getUnreadCount(event, user.id)

  return { count }
})
