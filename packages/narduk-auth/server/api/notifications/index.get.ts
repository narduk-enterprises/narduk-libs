import { createError, defineEventHandler, getQuery } from 'h3'
import { z } from 'zod'

import { requireAuth } from '#layer/server/utils/auth'
import { getUserNotifications } from '#narduk-auth-server/utils/notifications'

const querySchema = z.object({
  unreadOnly: z.string().optional(),
  limit: z.string().optional(),
})

/**
 * GET /api/notifications
 *
 * Returns the authenticated user's notifications, newest first.
 * Query params: ?unreadOnly=true&limit=20
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const raw = getQuery(event)
  const parsed = querySchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query parameters' })
  }
  const query = parsed.data

  const unreadOnly = query.unreadOnly === 'true'
  const limit = query.limit ? Math.min(Number.parseInt(query.limit, 10), 100) : 50

  const items = await getUserNotifications(event, user.id, { unreadOnly, limit })

  return { notifications: items }
})
