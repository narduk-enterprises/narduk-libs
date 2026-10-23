import { getDatabaseRows } from '@narduk-enterprises/narduk-core/server/utils/database'
import {
  defineAdminMutation,
  withValidatedBody,
} from '@narduk-enterprises/narduk-core/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '@narduk-enterprises/narduk-core/server/utils/rateLimit'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
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

    const updated = await getDatabaseRows(
      db
        .update(table)
        .set({
          content: body.content,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(table.name, body.name))
        .returning({ name: table.name }),
    )
    // An update that matched no row saved nothing: do not report success.
    if (updated.length === 0) {
      throw createError({ statusCode: 404, message: 'No such system prompt.' })
    }

    return { success: true }
  },
)
