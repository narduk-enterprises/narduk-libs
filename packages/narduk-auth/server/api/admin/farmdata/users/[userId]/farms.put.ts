import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'

import {
  defineAdminMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { farmDataUserFarms } from '#narduk-auth-server/database/app-schema'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'

const bodySchema = z.object({
  farm_ids: z.array(z.string().trim().min(1).max(128)).max(256),
})

export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminUsers,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const userId = event.context.params?.userId
    if (!userId) {
      throw createError({ statusCode: 400, statusMessage: 'userId is required.' })
    }
    const farmIDs = [...new Set(input.farm_ids)].sort()
    const db = useAuthBridgeDatabase(event)
    await db.delete(farmDataUserFarms).where(eq(farmDataUserFarms.userId, userId))
    if (farmIDs.length > 0) {
      await db.insert(farmDataUserFarms).values(
        farmIDs.map((farmId) => ({ userId, farmId, createdAt: new Date().toISOString() })),
      )
    }
    return { user_id: userId, farm_ids: farmIDs }
  },
)
