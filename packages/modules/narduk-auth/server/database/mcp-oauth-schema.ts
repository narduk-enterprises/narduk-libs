import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The KV-shaped store behind the MCP OAuth authorization server
 * (`drizzle/0005_mcp_oauth.sql`). Rows are the library's records keyed by
 * hashes; `expires_at` is unix seconds and `null` never expires.
 */
export const authOAuthKv = sqliteTable('auth_oauth_kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  metadata: text('metadata'),
  expiresAt: integer('expires_at'),
})
