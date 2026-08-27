import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'

import { executeDatabaseQuery, useDatabase } from '#layer/server/utils/database'
import {
  defineAdminMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { users } from '#narduk-core/schema'

const schema = z.object({
  userId: z.string().min(1),
  isAdmin: z.boolean(),
})

export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminUsers,
    parseBody: withValidatedBody(schema.parse),
  },
  async ({ event, admin, body }) => {
    const input = requireMutationBody(body)
    // Prevent admin from removing their own admin privileges by accident
    if (input.userId === admin.id && !input.isAdmin) {
      throw createError({ statusCode: 403, message: 'Cannot demote yourself.' })
    }

    const db = useDatabase(event)

    const updated = await executeDatabaseQuery<unknown[]>(
      db
        .update(users)
        .set({
          isAdmin: input.isAdmin,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, input.userId))
        .returning(),
    )

    if (updated.length === 0) {
      throw createError({ statusCode: 404, statusMessage: 'User not found.' })
    }

    return { success: true }
  },
)
