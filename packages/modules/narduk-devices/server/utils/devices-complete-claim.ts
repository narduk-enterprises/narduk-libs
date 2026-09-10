import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import {
  devicesAuditEvents,
  devicesClaimSessions,
  devicesCredentials,
  devicesDevices,
  devicesScopedNonces,
  devicesSessions,
} from '../database/devices-schema'

import { DEVICES_INTERNAL_NONCE_PREFIX } from '../../shared/types/devices'

import { runDevicesBatch } from './devices-atomic'

import type { ClaimToken, CredentialClass, Device } from '../../shared/types/devices'
import type { DevicesDatabase } from './devices'
import type { BatchItem } from 'drizzle-orm/batch'

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
  /** When the single-writer row may be pruned: the claim session's expiry. */
  lockExpiresAt: number
  /**
   * The device proof's single-use nonce, burned **inside this batch** so it is
   * spent if and only if the re-issue is actually served
   * (narduk-libs#228 second review H2). Null on the completion path that
   * authenticates with a raw approval token and carries no proof.
   */
  proofNonce: ScopedNonceRef | null
  reissuedAt: number
}

/** A `(scope, nonce)` pair in `devices_scoped_nonces`, with its prune horizon. */
export interface ScopedNonceRef {
  expiresAt: number
  nonce: string
  scope: string
}

/**
 * Why a re-issue was not served, or that it was.
 *
 * `contended` and `proof_spent` are deliberately distinct. A contended caller
 * lost the single-writer race and spent **nothing**, so resending the identical
 * signed payload is a legitimate retry and will work. A `proof_spent` caller
 * presented a proof that verified but had already been redeemed, which is a
 * retry of a request that was already served — not a guess, and so not a
 * lockout failure either.
 */
export type ReissueOutcome = 'contended' | 'proof_spent' | 'served'

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
 * Concurrency is settled *inside* the batch, by a single-writer row keyed
 * `(narduk-devices:reissue:<deviceId>, <observed generation>)` in
 * `devices_scoped_nonces`: two callers that read the same generation contend
 * for one UNIQUE key and exactly one insert lands. Every later statement is
 * conditional on that row carrying this call's id, so the loser mutates
 * nothing — including the generation bump, which is now one of the gated
 * statements rather than an awaited compare-and-swap outside the transaction.
 *
 * Two properties come from putting the check and the write in one unit
 * (narduk-libs#228 review H3). A batch that throws rolls the lock row back with
 * everything else, so a transient D1 failure no longer leaves the generation
 * incremented with nothing rotated. And the winner is identified by a row only
 * this call could have written, rather than by a generation value a concurrent
 * winner would have written too — gating on the value alone would let a loser
 * revoke the credentials the winner had just inserted.
 *
 * A loser is *not* terminal: `false` here becomes a retryable status, because
 * the loser is a device replaying its own completion and the winner has
 * already rotated the credentials it was holding.
 */
export async function reissueCredentialsAtomically(
  db: DevicesDatabase,
  input: ReissueCredentialsInput,
  nextId: () => string,
): Promise<ReissueOutcome> {
  const { device, proofNonce, reissuedAt } = input
  const nextGeneration = device.revocationGeneration + 1
  const lockId = nextId()
  const proofNonceId = nextId()

  const text = (value: string, alias: string) => sql<string>`${value}`.as(alias)
  const nullable = (value: string | null, alias: string) => sql<string | null>`${value}`.as(alias)
  const numeric = (value: number | null, alias: string) => sql<number>`${value}`.as(alias)

  const heldLock = sql`EXISTS (SELECT 1 FROM devices_scoped_nonces WHERE id = ${lockId})`
  const deviceClaimed = sql`EXISTS (SELECT 1 FROM devices_devices WHERE id = ${device.id} AND status = 'claimed')`
  // Statement one refuses outright when the proof has already been redeemed,
  // so a spent proof never takes the lock and therefore cannot wedge the
  // generation it observed.
  const proofUnspent =
    proofNonce === null
      ? sql`1 = 1`
      : sql`NOT EXISTS (SELECT 1 FROM devices_scoped_nonces WHERE scope = ${proofNonce.scope} AND nonce = ${proofNonce.nonce})`
  const burnedProof =
    proofNonce === null
      ? null
      : sql`EXISTS (SELECT 1 FROM devices_scoped_nonces WHERE id = ${proofNonceId})`

  // Statement one of the batch: the single-writer claim. Two callers that read
  // the same generation contend for one UNIQUE (scope, nonce) key. It selects
  // from the device row so the insert can carry a WHERE clause; the row is
  // already known to exist, so the clause is the only thing deciding.
  const claimWriter = db
    .insert(devicesScopedNonces)
    .select(
      db
        .select({
          id: text(lockId, 'id'),
          scope: text(`${DEVICES_INTERNAL_NONCE_PREFIX}reissue:${device.id}`, 'scope'),
          nonce: text(String(device.revocationGeneration), 'nonce'),
          expiresAt: numeric(input.lockExpiresAt, 'expires_at'),
          createdAt: numeric(reissuedAt, 'created_at'),
        })
        .from(devicesDevices)
        .where(and(eq(devicesDevices.id, device.id), proofUnspent)),
    )
    .onConflictDoNothing()
    .returning({ id: devicesScopedNonces.id })

  /**
   * The proof's nonce, burned only once this call holds the lock and the device
   * is still claimed. Spending it here rather than in the caller is what makes
   * "spent" mean "served": a contended attempt rolls nothing forward, so the
   * device's own retry of the identical payload is admitted
   * (narduk-libs#228 second review H2).
   */
  const proofWriter =
    proofNonce === null
      ? null
      : db
          .insert(devicesScopedNonces)
          .select(
            db
              .select({
                id: text(proofNonceId, 'id'),
                scope: text(proofNonce.scope, 'scope'),
                nonce: text(proofNonce.nonce, 'nonce'),
                expiresAt: numeric(proofNonce.expiresAt, 'expires_at'),
                createdAt: numeric(reissuedAt, 'created_at'),
              })
              .from(devicesDevices)
              .where(
                and(eq(devicesDevices.id, device.id), sql`${heldLock} AND ${deviceClaimed}`),
              ),
          )
          .onConflictDoNothing()
          .returning({ id: devicesScopedNonces.id })

  // Every later statement is conditional on *this call* holding the writer row,
  // having burned its own proof nonce, and on the device still being claimed,
  // so a loser — or a device revoked between the read and the batch — mutates
  // nothing.
  const stillOurs =
    burnedProof === null
      ? sql`${heldLock} AND ${deviceClaimed}`
      : sql`${heldLock} AND ${burnedProof} AND ${deviceClaimed}`

  const bumpGeneration = db
    .update(devicesDevices)
    .set({ revocationGeneration: nextGeneration })
    .where(and(eq(devicesDevices.id, device.id), stillOurs))
    .returning({ id: devicesDevices.id })

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
          .where(and(eq(devicesDevices.id, device.id), stillOurs)),
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
        .where(and(eq(devicesDevices.id, device.id), stillOurs)),
    )
    .returning({ id: devicesAuditEvents.id })

  const statements = [
    claimWriter,
    ...(proofWriter === null ? [] : [proofWriter]),
    bumpGeneration,
    revokeCredentials,
    ...inserts,
    revokeSessions,
    audit,
  ] as unknown as [BatchItem<'sqlite'>, ...Array<BatchItem<'sqlite'>>]
  const firstCredentialInsert = (proofWriter === null ? 1 : 2) + 2
  const results = (await runDevicesBatch(db, statements)) as unknown as Array<Array<{ id: string }>>

  if ((results[0] ?? []).length === 0) {
    // Statement one landed nothing: either the proof was already redeemed — in
    // which case its row is there to be found — or another writer holds the
    // lock for this generation, which spends nothing and is retryable.
    return (await proofAlreadySpent(db, proofNonce)) ? 'proof_spent' : 'contended'
  }
  // The inserts are the proof: an empty insert means the device stopped being
  // claimed inside the transaction, so nothing was rotated.
  const insertedCredentials = results.slice(
    firstCredentialInsert,
    firstCredentialInsert + inserts.length,
  )
  return insertedCredentials.every((rows) => rows.length > 0) ? 'served' : 'contended'
}

/** Is this proof's `(scope, nonce)` already recorded as redeemed? */
async function proofAlreadySpent(
  db: DevicesDatabase,
  proofNonce: ScopedNonceRef | null,
): Promise<boolean> {
  if (proofNonce === null) return false
  const rows = await db
    .select({ id: devicesScopedNonces.id })
    .from(devicesScopedNonces)
    .where(
      and(
        eq(devicesScopedNonces.scope, proofNonce.scope),
        eq(devicesScopedNonces.nonce, proofNonce.nonce),
      ),
    )
    .limit(1)
    .all()
  return rows.length > 0
}
