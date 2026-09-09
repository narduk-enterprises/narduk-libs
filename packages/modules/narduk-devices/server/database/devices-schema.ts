import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import {
  AUTH_ATTEMPT_OUTCOMES,
  AUTH_ATTEMPT_SUBJECT_KINDS,
  CLAIM_SESSION_STATUSES,
  CREDENTIAL_CLASSES,
  DEVICE_STATUSES,
} from '../../shared/types/devices'

/**
 * Generic device tables (narduk-libs#171, mybo-at-v2 Wave A lane A1).
 *
 * D1/SQLite dialect only; the hand-written migration in
 * `drizzle/0001_devices.sql` is the DDL that actually runs, and
 * `tests/schema-migration-parity.test.ts` keeps the two in agreement.
 *
 * The same shape choices as narduk-tenancy: every timestamp is a millisecond
 * epoch INTEGER so the injectable `now()` clock is the only time source, and
 * `user_id` / `org_id` columns are opaque text with no cross-package foreign
 * key. Secrets never land here in the clear — claim tokens, approval tokens
 * and credential secrets are stored as SHA-256 digests.
 */
export const devicesDevices = sqliteTable(
  'devices_devices',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    installationId: text('installation_id').notNull(),
    hardwareFingerprint: text('hardware_fingerprint').notNull(),
    fingerprintAlgorithm: text('fingerprint_algorithm').notNull(),
    publicKey: text('public_key').notNull(),
    softwareVersion: text('software_version').notNull(),
    status: text('status', { enum: DEVICE_STATUSES }).notNull(),
    revocationGeneration: integer('revocation_generation').notNull().default(0),
    claimedAt: integer('claimed_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('devices_devices_org_resource_idx').on(table.orgId, table.resourceKind, table.resourceId),
    index('devices_devices_fingerprint_idx').on(table.hardwareFingerprint),
  ],
)

/** Digest-only, single-use, TTL-bounded claim tokens (QR / short code material). */
export const devicesClaimTokens = sqliteTable(
  'devices_claim_tokens',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    revokedAt: integer('revoked_at'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('devices_claim_tokens_token_hash_idx').on(table.tokenHash)],
)

/**
 * One row per `startClaim`. The approval columns hold the digest and binding
 * of the owner/admin approval token `issueApprovalToken` mints, so completion
 * can verify actor, org, resource, claim session, fingerprint and expiry
 * without a signing secret.
 */
export const devicesClaimSessions = sqliteTable(
  'devices_claim_sessions',
  {
    id: text('id').primaryKey(),
    claimTokenId: text('claim_token_id')
      .notNull()
      .references(() => devicesClaimTokens.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    hardwareFingerprint: text('hardware_fingerprint').notNull(),
    fingerprintAlgorithm: text('fingerprint_algorithm').notNull(),
    publicKey: text('public_key').notNull(),
    softwareVersion: text('software_version').notNull(),
    status: text('status', { enum: CLAIM_SESSION_STATUSES }).notNull(),
    expiresAt: integer('expires_at').notNull(),
    completedAt: integer('completed_at'),
    completionIdempotencyKey: text('completion_idempotency_key'),
    deviceId: text('device_id').references(() => devicesDevices.id),
    approvalTokenHash: text('approval_token_hash'),
    approvalUserId: text('approval_user_id'),
    approvalOrgId: text('approval_org_id'),
    approvalResourceKind: text('approval_resource_kind'),
    approvalResourceId: text('approval_resource_id'),
    approvalExpiresAt: integer('approval_expires_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('devices_claim_sessions_idempotency_idx').on(table.idempotencyKey),
    index('devices_claim_sessions_token_idx').on(table.claimTokenId),
  ],
)

export const devicesCredentials = sqliteTable(
  'devices_credentials',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devicesDevices.id, { onDelete: 'cascade' }),
    credentialClass: text('credential_class', { enum: CREDENTIAL_CLASSES }).notNull(),
    secretHash: text('secret_hash').notNull(),
    fingerprint: text('fingerprint').notNull(),
    version: integer('version').notNull(),
    issuedAt: integer('issued_at').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    index('devices_credentials_device_class_idx').on(table.deviceId, table.credentialClass),
  ],
)

export const devicesSessions = sqliteTable(
  'devices_sessions',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devicesDevices.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id')
      .notNull()
      .references(() => devicesCredentials.id, { onDelete: 'cascade' }),
    credentialClass: text('credential_class', { enum: CREDENTIAL_CLASSES }).notNull(),
    challengeId: text('challenge_id').notNull(),
    nonce: text('nonce').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    revocationGeneration: integer('revocation_generation').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('devices_sessions_device_idx').on(table.deviceId)],
)

/** Cloud-issued session-open challenges; a client nonce is valid only paired with one. */
export const devicesChallenges = sqliteTable(
  'devices_challenges',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devicesDevices.id, { onDelete: 'cascade' }),
    nonce: text('nonce').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('devices_challenges_device_idx').on(table.deviceId)],
)

/**
 * Replay cache keyed by (device, credential version, challenge, nonce, request
 * hash) until the challenge expires. The UNIQUE index is the replay check: an
 * insert that lands is a first presentation, one that conflicts is a replay.
 */
export const devicesReplayEntries = sqliteTable(
  'devices_replay_entries',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id').notNull(),
    credentialVersion: integer('credential_version').notNull(),
    challengeId: text('challenge_id').notNull(),
    nonce: text('nonce').notNull(),
    requestHash: text('request_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('devices_replay_entries_key_idx').on(
      table.deviceId,
      table.credentialVersion,
      table.challengeId,
      table.nonce,
      table.requestHash,
    ),
    index('devices_replay_entries_expires_at_idx').on(table.expiresAt),
  ],
)

/** One row per authentication attempt, the input to the lockout policy. */
export const devicesAuthAttempts = sqliteTable(
  'devices_auth_attempts',
  {
    id: text('id').primaryKey(),
    subjectKind: text('subject_kind', { enum: AUTH_ATTEMPT_SUBJECT_KINDS }).notNull(),
    subject: text('subject').notNull(),
    outcome: text('outcome', { enum: AUTH_ATTEMPT_OUTCOMES }).notNull(),
    at: integer('at').notNull(),
  },
  (table) => [
    index('devices_auth_attempts_subject_at_idx').on(table.subjectKind, table.subject, table.at),
  ],
)

/**
 * One row per mutation. `org_id` is nullable: a security lockout on an IP, or
 * a failed start against a token that does not exist, belongs to no org.
 */
export const devicesAuditEvents = sqliteTable(
  'devices_audit_events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id'),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    subjectKind: text('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    detailsJson: text('details_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('devices_audit_events_org_created_at_idx').on(table.orgId, table.createdAt),
    index('devices_audit_events_subject_idx').on(table.subjectKind, table.subjectId),
  ],
)

export type DeviceRow = typeof devicesDevices.$inferSelect
export type ClaimTokenRow = typeof devicesClaimTokens.$inferSelect
export type ClaimSessionRow = typeof devicesClaimSessions.$inferSelect
export type DeviceCredentialRow = typeof devicesCredentials.$inferSelect
export type DeviceSessionRow = typeof devicesSessions.$inferSelect
export type DeviceChallengeRow = typeof devicesChallenges.$inferSelect
export type DeviceReplayEntryRow = typeof devicesReplayEntries.$inferSelect
export type DeviceAuthAttemptRow = typeof devicesAuthAttempts.$inferSelect
export type DevicesAuditEventRow = typeof devicesAuditEvents.$inferSelect
