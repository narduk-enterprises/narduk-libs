import { sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import { users } from '#layer/server/database/schema'

/**
 * External sign-in identities linked to a local user (narduk-libs#1951).
 *
 * One row per provider account: `subject` is the provider's stable account id
 * (Google's `sub`). A provider account maps to one user, and a user holds at
 * most one account per provider. Sign in with Apple predates this table and
 * keeps `users.apple_id`.
 *
 * An app moving off Supabase imports `auth.identities` rows with
 * `provider = 'google'` here: `subject` is `identities.provider_id`, `user_id`
 * the local `users.id` the Supabase user became (README "Importing Google
 * identities").
 */
export const authIdentities = sqliteTable(
  'auth_identities',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: ['google'] }).notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The address the provider reported when the link was made; informational only. */
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
