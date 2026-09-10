import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import {
  devicesAuditEvents,
  devicesClaimSessions,
  devicesCredentials,
  devicesDevices,
  devicesSessions,
} from '../database/devices-schema'

import { runDevicesBatch } from './devices-atomic'

import type { ClaimToken, CredentialClass, Device } from '../../shared/types/devices'
import type { DevicesDatabase } from './devices'

export interface PreparedCredential {
  credentialClass: CredentialClass
  expiresAt: number | null
  fingerprint: string
  id: string
  secretHash: string
  version: number
}

export interface CompleteClaimBatchInput {
  approvedByUserId: string
  claimSessionId: string
  completedAt: number
  credentials: readonly PreparedCredential[]
  deviceId: string
  idempotencyKey: string
  installationId: string
  token: ClaimToken
}

/**
 * Claim completion is one transaction. The device row is inserted from the
 * pending, unexpired claim session; every later statement is conditional on
 * that device row existing. SQLite serialises write transactions, so of two
 * concurrent completions exactly one sees the session pending: the other's
 * device insert selects nothing, every conditional statement no-ops, and the
 * caller learns it lost from the empty first result.
 *
 * The claim token is *not* consumed here: `startClaimAtomically` consumed it
 * when the device redeemed it, in the transaction that created this session.
 */
export async function completeClaimAtomically(
  db: DevicesDatabase,
  input: CompleteClaimBatchInput,
  nextId: () => string,
): Promise<boolean> {
  const text = (value: string, alias: string) => sql<string>`${value}`.as(alias)
  const nullable = (value: string | null, alias: string) => sql<string | null>`${value}`.as(alias)
  const numeric = (value: number | null, alias: string) => sql<number>`${value}`.as(alias)
  const deviceExists = sql`EXISTS (SELECT 1 FROM devices_devices WHERE id = ${input.deviceId})`

  const device = db
    .insert(devicesDevices)
    .select(
      db
        .select({
          id: text(input.deviceId, 'id'),
          orgId: text(input.token.orgId, 'org_id'),
          resourceKind: text(input.token.resourceKind, 'resource_kind'),
          resourceId: text(input.token.resourceId, 'resource_id'),
          installationId: text(input.installationId, 'installation_id'),
          hardwareFingerprint: devicesClaimSessions.hardwareFingerprint,
          fingerprintAlgorithm: devicesClaimSessions.fingerprintAlgorithm,
          publicKey: devicesClaimSessions.publicKey,
          softwareVersion: devicesClaimSessions.softwareVersion,
          status: text('claimed', 'status'),
          revocationGeneration: numeric(0, 'revocation_generation'),
          claimedAt: numeric(input.completedAt, 'claimed_at'),
          revokedAt: numeric(null, 'revoked_at'),
          createdAt: numeric(input.completedAt, 'created_at'),
        })
        .from(devicesClaimSessions)
        .where(
          and(
            eq(devicesClaimSessions.id, input.claimSessionId),
            eq(devicesClaimSessions.status, 'pending_user_approval'),
            gt(devicesClaimSessions.expiresAt, input.completedAt),
          ),
        ),
    )
    .returning({ id: devicesDevices.id })

  const session = db
    .update(devicesClaimSessions)
    .set({
      status: 'claimed',
      completedAt: input.completedAt,
      completionIdempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId,
    })
    .where(
      and(
        eq(devicesClaimSessions.id, input.claimSessionId),
        eq(devicesClaimSessions.status, 'pending_user_approval'),
        deviceExists,
      ),
    )
    .returning({ id: devicesClaimSessions.id })

  const credentials = input.credentials.map((credential) =>
    db
      .insert(devicesCredentials)
      .select(
        db
          .select({
            id: text(credential.id, 'id'),
            deviceId: devicesDevices.id,
            credentialClass: text(credential.credentialClass, 'credential_class'),
            secretHash: text(credential.secretHash, 'secret_hash'),
            fingerprint: text(credential.fingerprint, 'fingerprint'),
            version: numeric(credential.version, 'version'),
            issuedAt: numeric(input.completedAt, 'issued_at'),
            expiresAt: numeric(credential.expiresAt, 'expires_at'),
            revokedAt: numeric(null, 'revoked_at'),
          })
          .from(devicesDevices)
          .where(eq(devicesDevices.id, input.deviceId)),
      )
      .returning({ id: devicesCredentials.id }),
  )

  const audit = db
    .insert(devicesAuditEvents)
    .select(
      db
        .select({
          id: text(nextId(), 'id'),
          orgId: nullable(input.token.orgId, 'org_id'),
          actorUserId: nullable(input.approvedByUserId, 'actor_user_id'),
          action: text('claim.complete', 'action'),
          subjectKind: text('device', 'subject_kind'),
          subjectId: devicesDevices.id,
          detailsJson: text(
            JSON.stringify({
              claimSessionId: input.claimSessionId,
              claimTokenId: input.token.id,
              installationId: input.installationId,
              resourceKind: input.token.resourceKind,
              resourceId: input.token.resourceId,
              credentialIds: input.credentials.map((credential) => credential.id),
            }),
            'details_json',
          ),
          createdAt: numeric(input.completedAt, 'created_at'),
        })
        .from(devicesDevices)
        .where(eq(devicesDevices.id, input.deviceId)),
    )
    .returning({ id: devicesAuditEvents.id })

  const [inserted] = await runDevicesBatch(db, [device, session, ...credentials, audit])
  return inserted.length > 0
}

export interface ReissueCredentialsInput {
  claimSessionId: string
  credentials: readonly PreparedCredential[]
  device: Device
  idempotencyKey: string
  reissuedAt: number
}

/**
 * Re-issue every active credential of an already-completed claim, atomically.
 *
 * This is what an idempotent replay of a completion serves. The library cannot
 * return the *original* secrets: only their digests were ever stored, and
 * retaining a reversible copy would put a live bearer in the database in the
 * clear for the claim session's remaining lifetime — the exact property the
 * claim ceremony exists to avoid. So a replay is served with a *fresh,
 * equivalent* set at the next version, and the superseded secrets die in the
 * same transaction. A device whose completion response was lost recovers; a
 * device that already had the first set is handed a working replacement rather
 * than an empty array it treats as fatal.
 *
 * Concurrency is settled before the batch by a compare-and-swap on the device's
 * `revocation_generation`: exactly one caller moves it from the generation it
 * observed, and every statement in the batch is conditional on the device
 * carrying the generation that caller wrote. A loser re-reads and reports the
 * completion as already served.
 */
export async function reissueCredentialsAtomically(
  db: DevicesDatabase,
  input: ReissueCredentialsInput,
  nextId: () => string,
): Promise<boolean> {
  const { device, reissuedAt } = input
  const nextGeneration = device.revocationGeneration + 1

  // Compare-and-swap: the single writer wins here, before anything is revoked.
  const owned = await db
    .update(devicesDevices)
    .set({ revocationGeneration: nextGeneration })
    .where(
      and(
        eq(devicesDevices.id, device.id),
        eq(devicesDevices.revocationGeneration, device.revocationGeneration),
        eq(devicesDevices.status, 'claimed'),
      ),
    )
    .returning({ id: devicesDevices.id })
    .all()
  if (owned.length === 0) return false

  const text = (value: string, alias: string) => sql<string>`${value}`.as(alias)
  const nullable = (value: string | null, alias: string) => sql<string | null>`${value}`.as(alias)
  const numeric = (value: number | null, alias: string) => sql<number>`${value}`.as(alias)
  // Every later statement is conditional on the generation this caller wrote,
  // so a device revoked between the swap and the batch mutates nothing.
  const stillOurs = sql`EXISTS (SELECT 1 FROM devices_devices WHERE id = ${device.id} AND revocation_generation = ${nextGeneration} AND status = 'claimed')`

  const revokeCredentials = db
    .update(devicesCredentials)
    .set({ revokedAt: reissuedAt })
    .where(
      and(
        eq(devicesCredentials.deviceId, device.id),
        isNull(devicesCredentials.revokedAt),
        stillOurs,
      ),
    )
    .returning({ id: devicesCredentials.id })

  const inserts = input.credentials.map((credential) =>
    db
      .insert(devicesCredentials)
      .select(
        db
          .select({
            id: text(credential.id, 'id'),
            deviceId: devicesDevices.id,
            credentialClass: text(credential.credentialClass, 'credential_class'),
            secretHash: text(credential.secretHash, 'secret_hash'),
            fingerprint: text(credential.fingerprint, 'fingerprint'),
            version: numeric(credential.version, 'version'),
            issuedAt: numeric(reissuedAt, 'issued_at'),
            expiresAt: numeric(credential.expiresAt, 'expires_at'),
            revokedAt: numeric(null, 'revoked_at'),
          })
          .from(devicesDevices)
          .where(
            and(
              eq(devicesDevices.id, device.id),
              eq(devicesDevices.revocationGeneration, nextGeneration),
            ),
          ),
      )
      .returning({ id: devicesCredentials.id }),
  )

  // The superseded secrets are dead, so any session opened with one dies too.
  const revokeSessions = db
    .update(devicesSessions)
    .set({ revokedAt: reissuedAt })
    .where(
      and(eq(devicesSessions.deviceId, device.id), isNull(devicesSessions.revokedAt), stillOurs),
    )
    .returning({ id: devicesSessions.id })

  const audit = db
    .insert(devicesAuditEvents)
    .select(
      db
        .select({
          id: text(nextId(), 'id'),
          orgId: nullable(device.orgId, 'org_id'),
          actorUserId: nullable(null, 'actor_user_id'),
          action: text('claim.reissue', 'action'),
          subjectKind: text('device', 'subject_kind'),
          subjectId: devicesDevices.id,
          detailsJson: text(
            JSON.stringify({
              claimSessionId: input.claimSessionId,
              // The key names the replayed request; it is not a bearer.
              completionIdempotencyKey: input.idempotencyKey,
              credentialIds: input.credentials.map((credential) => credential.id),
              revocationGeneration: nextGeneration,
            }),
            'details_json',
          ),
          createdAt: numeric(reissuedAt, 'created_at'),
        })
        .from(devicesDevices)
        .where(
          and(
            eq(devicesDevices.id, device.id),
            eq(devicesDevices.revocationGeneration, nextGeneration),
          ),
        ),
    )
    .returning({ id: devicesAuditEvents.id })

  const [, ...rest] = await runDevicesBatch(db, [
    revokeCredentials,
    ...inserts,
    revokeSessions,
    audit,
  ])
  // The inserts are the proof: an empty first insert means the device stopped
  // carrying our generation between the swap and the batch.
  const insertedCredentials = rest.slice(0, inserts.length) as Array<Array<{ id: string }>>
  return insertedCredentials.every((rows) => rows.length > 0)
}
