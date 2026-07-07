/**
 * POST /api/notifications/read-all
 *
 * Mark all notifications as read for the authenticated user.
 */
import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.notifications,
  },
  async ({ event, user }) => {
    await markAllNotificationsAsRead(event, user.id)

    return { ok: true }
  },
)
