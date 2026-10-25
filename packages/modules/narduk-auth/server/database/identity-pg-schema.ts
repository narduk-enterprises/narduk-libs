import { text, unique } from 'drizzle-orm/pg-core'

import { users } from '#layer/server/database/pg-schema'
import { nardukPgTable } from '#layer/server/database/pg-table'

/** PostgreSQL mirror of `identity-schema.ts`. */
export const authIdentities = nardukPgTable(
  'auth_identities',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: ['google'] }).notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    lastSignInAt: text('last_sign_in_at'),
  },
  (table) => [
    unique('auth_identities_provider_subject_unique').on(table.provider, table.subject),
    unique('auth_identities_user_id_provider_unique').on(table.userId, table.provider),
  ],
)

export type AuthIdentity = typeof authIdentities.$inferSelect
