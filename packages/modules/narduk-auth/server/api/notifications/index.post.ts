import { createError } from 'h3'
import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  AUTH_NOTIFICATION_SCOPES,
  createNotification,
} from '#narduk-auth-server/utils/notifications'

const createNotificationSchema = z.object({
  userId: z.string().min(1).optional(),
  kind: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  icon: z.string().min(1).optional(),
  actionUrl: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
})

/**
 * POST /api/notifications
 *
 * Create a notification for the current user. Admins may target another user
 * by supplying `userId`.
 */
export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.notifications,
    parseBody: withValidatedBody(createNotificationSchema.parse),
    requiredScopes: [AUTH_NOTIFICATION_SCOPES.write],
  },
  async ({ event, user, body }) => {
    const input = requireMutationBody(body)
    const targetUserId = input.userId ?? user.id
    if (targetUserId !== user.id && !user.isAdmin) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only admins can create notifications for other users.',
      })
    }

    const id = await createNotification(event, {
      userId: targetUserId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      icon: input.icon,
      actionUrl: input.actionUrl,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    })

    return { id }
  },
)
