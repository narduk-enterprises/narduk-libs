import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { users } from '#layer/server/database/schema'

/** One row moves atomically from a PKCE authorization code to a revocable session. */
export const authNativeSessions = sqliteTable('auth_native_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeHash: text('code_hash').unique(),
  codeExpiresAt: integer('code_expires_at').notNull(),
  accessHash: text('access_hash').unique(),
  accessExpiresAt: integer('access_expires_at'),
  refreshHash: text('refresh_hash').unique(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
})

/** Proof is tied to the actual address, so changing an account email invalidates it. */
export const authVerifiedEmails = sqliteTable('auth_verified_emails', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  verifiedAt: text('verified_at').notNull(),
})
