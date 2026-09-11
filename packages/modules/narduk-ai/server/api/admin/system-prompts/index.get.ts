import { getDatabaseRows } from '@narduk-enterprises/narduk-core/server/utils/database'
import {
  listResponse,
  parseListQuery,
} from '@narduk-enterprises/narduk-core/server/utils/listQuery'
import { defineAdminQuery } from '@narduk-enterprises/narduk-core/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '@narduk-enterprises/narduk-core/server/utils/rateLimit'
import { asc, desc } from 'drizzle-orm'

import {
  type AiSystemPrompt,
  getAiSystemPromptsTable,
  useAiDatabase,
} from '../../../utils/aiDatabase'

/** The 500-row ceiling this route has always enforced. */
const MAX_LIMIT = 500

/** `name` is the table's primary key and `updatedAt` its only other ordering. */
const SORTABLE = ['name', 'updatedAt'] as const

export default defineAdminQuery(
  {
    parseQuery: (event) =>
      parseListQuery(event, {
        defaultLimit: MAX_LIMIT,
        defaultSort: 'name:asc',
        maxLimit: MAX_LIMIT,
        // No free-text search here yet; `q` is rejected rather than ignored.
        searchable: false,
        sortable: SORTABLE,
      }),
    rateLimit: RATE_LIMIT_POLICIES.adminSystemPrompts,
  },
  async ({ event, query }) => {
    const db = useAiDatabase(event)
    const table = getAiSystemPromptsTable(event)
    const column = query.sort?.key === 'updatedAt' ? table.updatedAt : table.name
    const order = query.sort?.direction === 'desc' ? desc(column) : asc(column)

    // One page query, no count: `total` is null by contract.
    const items = await getDatabaseRows<AiSystemPrompt>(
      db.select().from(table).orderBy(order).limit(query.limit).offset(query.offset),
    )

    return listResponse(items, { query, total: null })
  },
)
