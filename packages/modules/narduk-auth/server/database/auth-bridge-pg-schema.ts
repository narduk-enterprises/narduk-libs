import { bigint, boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core'

import { users } from '#layer/server/database/pg-schema'

/**
 * PostgreSQL mirror of `auth-bridge-schema.ts` for Hyperdrive + `postgres.js`.
 *
 * Column names, defaults, indexes and CHECK values match the SQLite schema and
 * `drizzle-pg/*.sql`; `tests/schema-migration-parity.test.ts` applies those
 * files to a real PostgreSQL and diffs the catalog against this file.
 *
 * Epoch-second columns are `bigint` (number mode), not `integer`: a 32-bit
 * column overflows in January 2038 and a far-dated expiry would fail the
 * INSERT before then. Passkey signature counters are unsigned 32-bit values, so
 * they need `bigint` as well.
 */
const epochSeconds = (name: string) => bigint(name, { mode: 'number' })

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

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    localUserId: text('local_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authUserId: text('auth_user_id').notNull(),
    sessionIdentifier: text('session_identifier'),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: epochSeconds('expires_at').notNull(),
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
  },
  (table) => [
    index('auth_sessions_local_user_id_idx').on(table.localUserId),
    index('auth_sessions_auth_user_id_idx').on(table.authUserId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
)

/** Digest-only, single-use setup and reset links for the additive local-email flow. */
export const authEmailLinks = pgTable(
  'auth_email_links',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    purpose: text('purpose', { enum: ['setup', 'reset'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    redirectPath: text('redirect_path').notNull(),
    expiresAt: epochSeconds('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('auth_email_links_email_idx').on(table.email),
    index('auth_email_links_expires_at_idx').on(table.expiresAt),
  ],
)

/** Persistent, hashed identity-plus-IP counters for local email credentials. */
export const authLocalEmailAttempts = pgTable(
  'auth_local_email_attempts',
  {
    keyHash: text('key_hash').primaryKey(),
    failures: integer('failures').notNull().default(0),
    windowStartedAt: epochSeconds('window_started_at').notNull(),
    lockedUntil: epochSeconds('locked_until'),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index('auth_local_email_attempts_locked_until_idx').on(table.lockedUntil)],
)

/**
 * Registered passkeys (WebAuthn credentials) for the local backend.
 *
 * `id` is the base64url credential ID and is the primary key because
 * discoverable-credential authentication resolves a credential before it knows
 * which user is signing in. `rpId` is stored so authentication can refuse a
 * credential minted under a different Relying Party ID.
 */
export const authWebauthnCredentials = pgTable(
  'auth_webauthn_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').notNull().default('[]'),
    deviceType: text('device_type', { enum: ['singleDevice', 'multiDevice'] })
      .notNull()
      .default('singleDevice'),
    backedUp: boolean('backed_up').notNull().default(false),
    rpId: text('rp_id').notNull(),
    name: text('name'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    lastUsedAt: text('last_used_at'),
  },
  (table) => [
    index('auth_webauthn_credentials_user_id_idx').on(table.userId),
    index('auth_webauthn_credentials_rp_id_idx').on(table.rpId),
  ],
)

/** Digest-only, single-use, TTL-bounded WebAuthn ceremony challenges. */
export const authWebauthnChallenges = pgTable(
  'auth_webauthn_challenges',
  {
    challengeHash: text('challenge_hash').primaryKey(),
    purpose: text('purpose', { enum: ['registration', 'authentication'] }).notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: epochSeconds('expires_at').notNull(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index('auth_webauthn_challenges_expires_at_idx').on(table.expiresAt)],
)

export type AuthUserLink = typeof authUserLinks.$inferSelect
export type AuthSession = typeof authSessions.$inferSelect
export type AuthEmailLink = typeof authEmailLinks.$inferSelect
export type AuthLocalEmailAttempt = typeof authLocalEmailAttempts.$inferSelect
export type AuthWebauthnCredential = typeof authWebauthnCredentials.$inferSelect
export type AuthWebauthnChallenge = typeof authWebauthnChallenges.$inferSelect
