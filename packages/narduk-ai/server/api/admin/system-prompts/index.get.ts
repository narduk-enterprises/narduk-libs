import { getDatabaseRows } from '@narduk-enterprises/narduk-core/server/utils/database'
import { defineAdminQuery } from '@narduk-enterprises/narduk-core/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '@narduk-enterprises/narduk-core/server/utils/rateLimit'

import {
  type AiSystemPrompt,
  getAiSystemPromptsTable,
  useAiDatabase,
} from '#server/utils/aiDatabase'

export default defineAdminQuery(
  {
    rateLimit: RATE_LIMIT_POLICIES.adminSystemPrompts,
  },
  async ({ event }) => {
    const db = useAiDatabase(event)
    const table = getAiSystemPromptsTable(event)
    return getDatabaseRows<AiSystemPrompt>(db.select().from(table).limit(500))
  },
)
