import { bigint, index, text } from 'drizzle-orm/pg-core'

import { users } from '#layer/server/database/pg-schema'
import { nardukPgTable } from '#layer/server/database/pg-table'

const epochSeconds = (name: string) => bigint(name, { mode: 'number' })

/** PostgreSQL mirror of `native-auth-schema.ts`. */
export const authNativeSessions = nardukPgTable(
  'auth_native_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeHash: text('code_hash').unique(),
    codeExpiresAt: epochSeconds('code_expires_at').notNull(),
    accessHash: text('access_hash').unique(),
    accessExpiresAt: epochSeconds('access_expires_at'),
    refreshHash: text('refresh_hash').unique(),
    expiresAt: epochSeconds('expires_at').notNull(),
    revokedAt: epochSeconds('revoked_at'),
    createdAt: epochSeconds('created_at').notNull(),
  },
  (table) => [index('auth_native_sessions_user').on(table.userId)],
)

export const authVerifiedEmails = nardukPgTable('auth_verified_emails', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  verifiedAt: text('verified_at').notNull(),
})
