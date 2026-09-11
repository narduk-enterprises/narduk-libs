import { defineEventHandler } from 'h3'
import { z } from 'zod'

import { requireAuth } from '#layer/server/utils/auth'
import { listResponse, parseListQuery } from '#layer/server/utils/listQuery'
import { getUserNotifications } from '#narduk-auth-server/utils/notifications'

/** Page ceiling this route has always enforced; now a clamp, not a silent cap. */
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

/**
 * `createdAt` is the only ordering this route has ever served, so it is the
 * whole allowlist.
 */
const SORTABLE = ['createdAt'] as const

const FILTERS = z.object({ unreadOnly: z.enum(['false', 'true']).optional() })

/**
 * GET /api/notifications
 *
 * The authenticated user's notifications, newest first, in the shared
 * list-query contract: `?limit=20&offset=20&unreadOnly=true`.
 *
 * `total` is `null` — this route deliberately does not count, so one page
 * costs exactly one query. `/api/notifications/unread-count` is the count.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const query = parseListQuery(event, {
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: 'createdAt:desc',
    filters: FILTERS,
    maxLimit: MAX_LIMIT,
    sortable: SORTABLE,
  })

  const items = await getUserNotifications(event, user.id, {
    limit: query.limit,
    offset: query.offset,
    unreadOnly: query.filters.unreadOnly === 'true',
  })

  return listResponse(items, { query, total: null })
})
