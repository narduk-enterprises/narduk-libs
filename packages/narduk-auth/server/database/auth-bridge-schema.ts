import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { users } from '#layer/server/database/schema'

/**
 * Template-managed authentication bridge tables.
 *
 * The shared layer continues to own the local `users` table and sealed session
 * cookie model. These tables attach shared fleet identity (`auth_user_id`) and
 * app-local auth session state to those local user rows.
 */
export const authUserLinks = sqliteTable('auth_user_links', {
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

export const authSessions = sqliteTable('auth_sessions', {
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
  recoveryMode: integer('recovery_mode', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

/** Digest-only, single-use setup and reset links for the additive local-email flow. */
export const authEmailLinks = sqliteTable('auth_email_links', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  purpose: text('purpose').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  redirectPath: text('redirect_path').notNull(),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: text('consumed_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

/** Persistent, hashed identity-plus-IP counters for local email credentials. */
export const authLocalEmailAttempts = sqliteTable('auth_local_email_attempts', {
  keyHash: text('key_hash').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStartedAt: integer('window_started_at').notNull(),
  lockedUntil: integer('locked_until'),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export type AuthUserLink = typeof authUserLinks.$inferSelect
export type AuthSession = typeof authSessions.$inferSelect
export type AuthEmailLink = typeof authEmailLinks.$inferSelect
export type AuthLocalEmailAttempt = typeof authLocalEmailAttempts.$inferSelect
