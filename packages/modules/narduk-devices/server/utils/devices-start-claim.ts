import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import {
  devicesAuditEvents,
  devicesClaimSessions,
  devicesClaimTokens,
} from '../database/devices-schema'

import { runDevicesBatch } from './devices-atomic'

import type { ClaimToken } from '../../shared/types/devices'
import type { DevicesDatabase } from './devices'

export interface StartClaimBatchInput {
  claimSessionId: string
  createdAt: number
  fingerprintAlgorithm: string
  hardwareFingerprint: string
  idempotencyKey: string
  publicKey: string
  softwareVersion: string
  token: ClaimToken
}

/**
 * Redeeming a claim token is one transaction: the claim session is inserted
 * *from* the token row, gated on that row still being unconsumed, unrevoked and
 * unexpired, and the same transaction stamps the token consumed and names the
 * session that consumed it. The token's single use is therefore evaluated in
 * the mutation, never in an earlier read — the pattern
 * `narduk-tenancy/server/utils/tenancy-atomic.ts` uses for invitation claims.
 *
 * Two concurrent starts on one token cannot both win: SQLite serialises write
 * transactions, so the second sees `consumed_at` already set, selects nothing,
 * inserts nothing, and learns it lost from the empty first result. The UNIQUE
 * index on `devices_claim_sessions(claim_token_id)` is the backstop, and
 * `onConflictDoNothing` keeps a raced duplicate a lost race rather than a throw.
 */
export async function startClaimAtomically(
  db: DevicesDatabase,
  input: StartClaimBatchInput,
  nextId: () => string,
): Promise<boolean> {
  const text = (value: string, alias: string) => sql<string>`${value}`.as(alias)
  const nullable = (value: string | null, alias: string) => sql<string | null>`${value}`.as(alias)
  const numeric = (value: number | null, alias: string) => sql<number>`${value}`.as(alias)
  const sessionExists = sql`EXISTS (SELECT 1 FROM devices_claim_sessions WHERE id = ${input.claimSessionId})`

  const session = db
    .insert(devicesClaimSessions)
    .select(
      db
        .select({
          id: text(input.claimSessionId, 'id'),
          claimTokenId: devicesClaimTokens.id,
          idempotencyKey: text(input.idempotencyKey, 'idempotency_key'),
          hardwareFingerprint: text(input.hardwareFingerprint, 'hardware_fingerprint'),
          fingerprintAlgorithm: text(input.fingerprintAlgorithm, 'fingerprint_algorithm'),
          publicKey: text(input.publicKey, 'public_key'),
          softwareVersion: text(input.softwareVersion, 'software_version'),
          status: text('pending_user_approval', 'status'),
          expiresAt: devicesClaimTokens.expiresAt,
          completedAt: numeric(null, 'completed_at'),
          completionIdempotencyKey: nullable(null, 'completion_idempotency_key'),
          deviceId: nullable(null, 'device_id'),
          approvalTokenHash: nullable(null, 'approval_token_hash'),
          approvalUserId: nullable(null, 'approval_user_id'),
          approvalOrgId: nullable(null, 'approval_org_id'),
          approvalResourceKind: nullable(null, 'approval_resource_kind'),
          approvalResourceId: nullable(null, 'approval_resource_id'),
          approvalExpiresAt: numeric(null, 'approval_expires_at'),
          createdAt: numeric(input.createdAt, 'created_at'),
        })
        .from(devicesClaimTokens)
        .where(
          and(
            eq(devicesClaimTokens.id, input.token.id),
            isNull(devicesClaimTokens.consumedAt),
            isNull(devicesClaimTokens.revokedAt),
            gt(devicesClaimTokens.expiresAt, input.createdAt),
          ),
        ),
    )
    .onConflictDoNothing()
    .returning({ id: devicesClaimSessions.id })

  const consumeToken = db
    .update(devicesClaimTokens)
    .set({ consumedAt: input.createdAt, consumedByClaimSessionId: input.claimSessionId })
    .where(and(eq(devicesClaimTokens.id, input.token.id), sessionExists))
    .returning({ id: devicesClaimTokens.id })

  const audit = db
    .insert(devicesAuditEvents)
    .select(
      db
        .select({
          id: text(nextId(), 'id'),
          orgId: nullable(input.token.orgId, 'org_id'),
          actorUserId: nullable(null, 'actor_user_id'),
          action: text('claim.start', 'action'),
          subjectKind: text('claim_session', 'subject_kind'),
          subjectId: devicesClaimSessions.id,
          detailsJson: text(
            JSON.stringify({
              claimTokenId: input.token.id,
              hardwareFingerprint: input.hardwareFingerprint,
              fingerprintAlgorithm: input.fingerprintAlgorithm,
              softwareVersion: input.softwareVersion,
              expiresAt: input.token.expiresAt,
            }),
            'details_json',
          ),
          createdAt: numeric(input.createdAt, 'created_at'),
        })
        .from(devicesClaimSessions)
        .where(eq(devicesClaimSessions.id, input.claimSessionId)),
    )
    .returning({ id: devicesAuditEvents.id })

  const [inserted] = await runDevicesBatch(db, [session, consumeToken, audit])
  return inserted.length > 0
}
