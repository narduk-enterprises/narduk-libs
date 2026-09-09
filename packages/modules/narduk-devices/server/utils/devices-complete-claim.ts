import { and, eq, gt, sql } from 'drizzle-orm'

import {
  devicesAuditEvents,
  devicesClaimSessions,
  devicesClaimTokens,
  devicesCredentials,
  devicesDevices,
} from '../database/devices-schema'

import { runDevicesBatch } from './devices-atomic'

import type { ClaimToken, CredentialClass } from '../../shared/types/devices'
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

  const consumeToken = db
    .update(devicesClaimTokens)
    .set({ consumedAt: input.completedAt })
    .where(and(eq(devicesClaimTokens.id, input.token.id), deviceExists))
    .returning({ id: devicesClaimTokens.id })

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

  const [inserted] = await runDevicesBatch(db, [
    device,
    session,
    consumeToken,
    ...credentials,
    audit,
  ])
  return inserted.length > 0
}
