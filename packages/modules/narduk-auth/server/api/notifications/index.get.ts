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

/** Any string, matching the pre-contract schema; only `'true'` filters. */
const FILTERS = z.object({ unreadOnly: z.string().optional() })

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
    // No free-text search over a user's notifications yet; `q` is rejected
    // rather than accepted and quietly dropped.
    searchable: false,
    sortable: SORTABLE,
  })

  const items = await getUserNotifications(event, user.id, {
    limit: query.limit,
    offset: query.offset,
    unreadOnly: query.filters.unreadOnly === 'true',
  })

  const body = listResponse(items, { query, total: null })
  return {
    ...body,
    // Deprecated alias: keep `{ notifications }` so existing consumers still
    // read. Drop in the next narduk-auth major once fleet apps use `items`.
    notifications: items,
  }
})
