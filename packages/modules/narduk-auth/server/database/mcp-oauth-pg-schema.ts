import { bigint, index, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * PostgreSQL mirror of `mcp-oauth-schema.ts`: the KV-shaped store behind the
 * MCP OAuth authorization server. `expires_at` is unix seconds; `null` never
 * expires.
 */
export const authOAuthKv = pgTable(
  'auth_oauth_kv',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    metadata: text('metadata'),
    expiresAt: bigint('expires_at', { mode: 'number' }),
  },
  (table) => [index('auth_oauth_kv_expires').on(table.expiresAt)],
)
