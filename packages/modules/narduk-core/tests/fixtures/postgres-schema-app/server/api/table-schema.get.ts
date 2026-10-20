import { getTableConfig } from 'drizzle-orm/pg-core'

import { apiKeys } from '#narduk-core/schema'

export default defineEventHandler(() => ({
  schema: getTableConfig(apiKeys).schema ?? 'public',
  table: getTableConfig(apiKeys).name,
}))
