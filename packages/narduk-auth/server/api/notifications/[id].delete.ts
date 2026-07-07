/**
 * DELETE /api/notifications/:id
 *
 * Delete a single notification. Owner-only.
 */
import { createError, getRouterParam } from 'h3'

import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { deleteNotification } from '#narduk-auth-server/utils/notifications'

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.notifications,
  },
  async ({ event, user }) => {
    const notificationId = getRouterParam(event, 'id')

    if (!notificationId) {
      throw createError({ statusCode: 400, message: 'Notification ID is required.' })
    }

    await deleteNotification(event, notificationId, user.id)

    return { ok: true }
  },
)
