import { executeDatabaseQuery } from '@narduk-enterprises/narduk-core/server/utils/database'
import {
  defineAdminMutation,
  withValidatedBody,
} from '@narduk-enterprises/narduk-core/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '@narduk-enterprises/narduk-core/server/utils/rateLimit'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { getAiSystemPromptsTable, useAiDatabase } from '../../../utils/aiDatabase'

const schema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
})

export default defineAdminMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminSystemPrompts,
    parseBody: withValidatedBody(schema.parse),
  },
  async ({ event, body }) => {
    const db = useAiDatabase(event)
    const table = getAiSystemPromptsTable(event)

    await executeDatabaseQuery(
      db
        .update(table)
        .set({
          content: body.content,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(table.name, body.name)),
    )

    return { success: true }
  },
)
