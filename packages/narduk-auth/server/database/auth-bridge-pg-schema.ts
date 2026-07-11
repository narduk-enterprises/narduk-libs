import { boolean, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'

import { users } from '#layer/server/database/pg-schema'

/**
 * PostgreSQL mirror of the template-managed auth bridge tables.
 *
 * Downstream Postgres apps keep the same bridge contract as D1-backed apps,
 * but the actual table definitions must use pg-core so Drizzle queries and
 * migration generation stay dialect-safe.
 */
export const authUserLinks = pgTable('auth_user_links', {
  localUserId: text('local_user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  authUserId: text('auth_user_id').notNull().unique(),
  primaryEmail: text('primary_email').notNull().unique(),
  lastProvider: text('last_provider'),
  providersJson: text('providers_json').notNull().default('[]'),
  emailConfirmedAt: text('email_confirmed_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  localUserId: text('local_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  authUserId: text('auth_user_id').notNull(),
  sessionIdentifier: text('session_identifier'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
  aal: text('aal'),
  currentProvider: text('current_provider'),
  providersJson: text('providers_json').notNull().default('[]'),
  recoveryMode: boolean('recovery_mode').notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const farmDataUserFarms = pgTable(
  'farmdata_user_farms',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    farmId: text('farm_id').notNull(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.userId, table.farmId] }),
  }),
)

export type AuthUserLink = typeof authUserLinks.$inferSelect
export type AuthSession = typeof authSessions.$inferSelect
export type FarmDataUserFarm = typeof farmDataUserFarms.$inferSelect
