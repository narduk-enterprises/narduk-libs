import { and, desc, eq, isNull, lt } from 'drizzle-orm'

import { DEVICES_LOCKOUT_POLICY } from '../../shared/utils/lockout-policy'
import {
  devicesAuditEvents,
  devicesChallenges,
  devicesClaimSessions,
  devicesClaimTokens,
  devicesCredentials,
  devicesDevices,
  devicesReplayEntries,
  devicesSessions,
} from '../database/devices-schema'

import { completeClaimAtomically, type PreparedCredential } from './devices-complete-claim'
import { DevicesError } from './devices-error'
import { createLockoutGate, type LockoutSubject } from './devices-lockout'
import {
  base64UrlDecode,
  canonicalBytes,
  type CanonicalValue,
  ED25519_PUBLIC_KEY_BYTES,
  isBase64Url,
  randomBase64Url,
  sha256Hex,
  type SignatureVerifier,
  verifyEd25519,
} from './devices-signing'

import type {
  ClaimCompleteStatus,
  ClaimSession,
  ClaimStartStatus,
  ClaimToken,
  CredentialClass,
  Device,
  DeviceChallenge,
  DeviceCredential,
  DevicesAuditAction,
  DevicesAuditEvent,
  DeviceSession,
  DevicesResourceRef,
  IssuedCredential,
} from '../../shared/types/devices'
import type { SQL } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

/**
 * The database this service is written against: the D1-shaped drizzle surface
 * a Narduk app already has (`LayerDatabase` in narduk-core is exactly this
 * shape). Only the four query-builder entry points are required, so a consumer
 * may pass a drizzle database carrying any schema.
 *
 * Every call site awaits `.get()`/`.all()`/`.run()`, which makes the service
 * dialect-neutral in behaviour: the synchronous better-sqlite3 driver returns
 * values rather than promises and awaiting them is equivalent. Tests use that
 * driver behind one documented cast.
 */
export type DevicesDatabase = Pick<
  BaseSQLiteDatabase<'async', unknown>,
  'select' | 'insert' | 'update' | 'delete'
>

export interface DevicesServiceOptions {
  /** Owner/admin approval token lifetime. Default 5 minutes. */
  approvalTtlSeconds?: number
  /** Session-open challenge lifetime; also bounds the replay cache. Default 5 minutes. */
  challengeTtlSeconds?: number
  /** Primary-key generator. Defaults to `crypto.randomUUID()`. */
  idGenerator?: () => string
  /** Millisecond epoch clock. Injectable so tests own time. */
  now?: () => number
  /** Credential secret generator. Defaults to 256 random bits, base64url. */
  secretGenerator?: () => string
  /** Device session lifetime. Default 30 minutes. */
  sessionTtlSeconds?: number
  /** Accepted |request timestamp − now|. Default 5 minutes. */
  timestampSkewSeconds?: number
  /** Claim and approval token generator. Defaults to 256 random bits, base64url. */
  tokenGenerator?: () => string
  /** Ed25519 verifier. Defaults to WebCrypto; inject for runtimes without it. */
  verifySignature?: SignatureVerifier
}

export const CLAIM_TOKEN_DEFAULT_TTL_SECONDS = DEVICES_LOCKOUT_POLICY.claimTokenTtlSeconds
/** base64url characters carrying at least `claimTokenMinBits` of entropy. */
export const CLAIM_TOKEN_MIN_LENGTH = Math.ceil(DEVICES_LOCKOUT_POLICY.claimTokenMinBits / 6)
export const APPROVAL_DEFAULT_TTL_SECONDS = 300
export const CHALLENGE_DEFAULT_TTL_SECONDS = 300
export const SESSION_DEFAULT_TTL_SECONDS = 1800
export const TIMESTAMP_SKEW_DEFAULT_SECONDS = 300
export const AUDIT_EVENTS_DEFAULT_LIMIT = 50
export const AUDIT_EVENTS_MAX_LIMIT = 200
export const DEVICE_LIST_MAX_LIMIT = 200

const CREDENTIAL_FINGERPRINT_DOMAIN = 'narduk-devices:credential-fingerprint:'

/**
 * Explicitly `T | undefined` regardless of the project's index-access strictness,
 * so every "row missing" branch below narrows honestly.
 */
function first<T>(rows: T[]): T | undefined {
  return rows.at(0)
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new DevicesError('invalid', `${field} must not be empty.`)
  }
  return trimmed
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DevicesError('invalid', `${field} must be a positive whole number.`)
  }
  return value
}

function defaultTokenGenerator(): string {
  // 256 bits, comfortably above the >=128-bit floor the claim contract states.
  return randomBase64Url(32)
}

function sameResource(a: DevicesResourceRef, b: DevicesResourceRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

export interface RemoteContext {
  /** Opaque key for the account behind the request (a user id, an API key id). */
  accountKey?: string
  ip?: string
}

export interface CreateClaimTokenInput {
  createdByUserId: string
  orgId: string
  resource: DevicesResourceRef
  ttlSeconds?: number
}

export interface CreateClaimTokenResult {
  expiresAt: number
  token: string
  tokenId: string
}

export interface StartClaimInput {
  claimToken: string
  devicePublicKey: string
  hardwareFingerprint: string
  hardwareFingerprintAlgorithm: string
  idempotencyKey: string
  remote?: RemoteContext
  softwareVersion: string
}

export interface StartClaimResult {
  /** Null when the outcome produced no claim session (invalid, expired, revoked, locked). */
  claimSessionId: string | null
  expiresAt: number
  retryAfterSeconds?: number
  status: ClaimStartStatus
}

export interface IssueApprovalTokenInput {
  approvedByUserId: string
  claimSessionId: string
  hardwareFingerprint: string
  orgId: string
  resource: DevicesResourceRef
  ttlSeconds?: number
}

export interface IssueApprovalTokenResult {
  expiresAt: number
  token: string
}

export interface CompleteClaimInput {
  approvedByUserId: string
  claimSessionId: string
  hardwareFingerprint: string
  idempotencyKey: string
  installationId: string
  orgId: string
  remote?: RemoteContext
  resource: DevicesResourceRef
  userApprovalToken: string
}

export interface CompleteClaimResult {
  /** Secrets are present only on `completed`; a replay returns metadata-free `[]`. */
  credentials: IssuedCredential[]
  deviceId?: string
  retryAfterSeconds?: number
  status: ClaimCompleteStatus
}

export interface IssueChallengeInput {
  deviceId: string
}

export interface IssueChallengeResult {
  challengeId: string
  expiresAt: number
  nonce: string
}

/**
 * The bytes the device signs, as canonical JSON (sorted keys, no whitespace).
 * `resource` nests as `{ id, kind }` and is sorted like every other object.
 */
export interface CanonicalSessionRequest {
  challengeId: string
  credentialVersion: number
  deviceId: string
  installationId: string
  method: string
  nonce: string
  requestHash: string
  resource: DevicesResourceRef
  route: string
  timestamp: number
}

export interface OpenSessionInput {
  canonicalRequest: CanonicalSessionRequest
  credentialClass: CredentialClass
  credentialId: string
  deviceId: string
  remote?: RemoteContext
  /** Base64url Ed25519 signature over `canonicalBytes(canonicalRequest)`. */
  signature: string
}

export interface OpenSessionResult {
  expiresAt: number
  revocationGeneration: number
  sessionId: string
}

export interface HeartbeatResult {
  /** The device's current generation; greater than the session's means re-open. */
  deviceRevocationGeneration: number
  expiresAt: number
  revocationGeneration: number
  sessionId: string
  stale: boolean
}

export interface ActorInput {
  actorUserId?: string | null
  reason?: string
}

export interface RotateCredentialInput extends ActorInput {
  credentialClass: CredentialClass
  deviceId: string
  expiresAt?: number | null
}

export interface ListDevicesInput {
  includeRevoked?: boolean
  limit?: number
  orgId: string
  resource?: DevicesResourceRef
}

export interface ListAuditEventsInput {
  /** Millisecond epoch; returns events strictly older than this. */
  before?: number
  limit?: number
  orgId?: string
  subject?: { id: string; kind: string }
}

export interface DevicesService {
  completeClaim: (input: CompleteClaimInput) => Promise<CompleteClaimResult>
  createClaimToken: (input: CreateClaimTokenInput) => Promise<CreateClaimTokenResult>
  getClaimSession: (claimSessionId: string) => Promise<ClaimSession | null>
  getDevice: (deviceId: string) => Promise<Device | null>
  /** The active (unexpired, unrevoked) session, or null. */
  getSession: (sessionId: string) => Promise<DeviceSession | null>
  heartbeat: (input: { sessionId: string }) => Promise<HeartbeatResult>
  issueApprovalToken: (input: IssueApprovalTokenInput) => Promise<IssueApprovalTokenResult>
  issueChallenge: (input: IssueChallengeInput) => Promise<IssueChallengeResult>
  listAuditEvents: (input?: ListAuditEventsInput) => Promise<DevicesAuditEvent[]>
  listDevices: (input: ListDevicesInput) => Promise<Device[]>
  openSession: (input: OpenSessionInput) => Promise<OpenSessionResult>
  revokeClaimToken: (input: ActorInput & { claimTokenId: string }) => Promise<ClaimToken>
  revokeDevice: (input: ActorInput & { deviceId: string }) => Promise<Device>
  revokeSession: (input: ActorInput & { sessionId: string }) => Promise<DeviceSession>
  rotateCredential: (input: RotateCredentialInput) => Promise<IssuedCredential>
  startClaim: (input: StartClaimInput) => Promise<StartClaimResult>
  /** Bearer verification of a shown-once secret; the active credential or null. */
  verifyCredentialSecret: (input: {
    credentialId: string
    secret: string
  }) => Promise<DeviceCredential | null>
}

/**
 * Build the devices service over a caller-supplied database.
 *
 * Nothing here reads ambient request state, environment variables, or another
 * package's session: the consumer owns identity (who may mint claim tokens and
 * approve claims is a narduk-tenancy question) and passes user ids in.
 */
export function createDevices(
  db: DevicesDatabase,
  options: DevicesServiceOptions = {},
): DevicesService {
  const now = options.now ?? (() => Date.now())
  const nextId = options.idGenerator ?? (() => globalThis.crypto.randomUUID())
  const nextToken = options.tokenGenerator ?? defaultTokenGenerator
  const nextSecret = options.secretGenerator ?? defaultTokenGenerator
  const verifySignature = options.verifySignature ?? verifyEd25519
  const approvalTtlMs = (options.approvalTtlSeconds ?? APPROVAL_DEFAULT_TTL_SECONDS) * 1000
  const challengeTtlMs = (options.challengeTtlSeconds ?? CHALLENGE_DEFAULT_TTL_SECONDS) * 1000
  const sessionTtlMs = (options.sessionTtlSeconds ?? SESSION_DEFAULT_TTL_SECONDS) * 1000
  const skewMs = (options.timestampSkewSeconds ?? TIMESTAMP_SKEW_DEFAULT_SECONDS) * 1000
  const lockouts = createLockoutGate(db, now, nextId)

  async function audit(input: {
    action: DevicesAuditAction
    actorUserId?: string | null
    details?: Record<string, unknown>
    orgId: string | null
    subjectId: string
    subjectKind: string
  }): Promise<void> {
    await db
      .insert(devicesAuditEvents)
      .values({
        id: nextId(),
        orgId: input.orgId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        detailsJson: JSON.stringify(input.details ?? {}),
        createdAt: now(),
      })
      .run()
  }

  /** Records an attempt and writes the security audit row for any escalating threshold crossed. */
  async function recordAttempt(
    subjects: readonly LockoutSubject[],
    outcome: 'success' | 'failure',
    context: { orgId: string | null; reason?: string },
  ): Promise<void> {
    const crossed = await lockouts.record(subjects, outcome)
    for (const threshold of crossed) {
      // eslint-disable-next-line no-await-in-loop -- one audit row per crossed threshold, in order; the list is at most two long
      await audit({
        orgId: context.orgId,
        action: 'security.lockout',
        subjectKind: threshold.subject.kind,
        subjectId: threshold.subject.subject,
        details: {
          failures: threshold.failures,
          cooldownSeconds: threshold.cooldownSeconds,
          reason: context.reason ?? null,
        },
      })
    }
  }

  function remoteSubjects(remote: RemoteContext | undefined): LockoutSubject[] {
    const subjects: LockoutSubject[] = []
    if (remote?.accountKey) subjects.push({ kind: 'account', subject: remote.accountKey })
    if (remote?.ip) subjects.push({ kind: 'ip', subject: remote.ip })
    return subjects
  }

  async function findClaimTokenByHash(tokenHash: string): Promise<ClaimToken | undefined> {
    return first(
      await db
        .select()
        .from(devicesClaimTokens)
        .where(eq(devicesClaimTokens.tokenHash, tokenHash))
        .limit(1)
        .all(),
    )
  }

  async function findClaimToken(id: string): Promise<ClaimToken | undefined> {
    return first(
      await db
        .select()
        .from(devicesClaimTokens)
        .where(eq(devicesClaimTokens.id, id))
        .limit(1)
        .all(),
    )
  }

  async function findClaimSession(id: string): Promise<ClaimSession | undefined> {
    return first(
      await db
        .select()
        .from(devicesClaimSessions)
        .where(eq(devicesClaimSessions.id, id))
        .limit(1)
        .all(),
    )
  }

  async function findDevice(id: string): Promise<Device | undefined> {
    return first(
      await db.select().from(devicesDevices).where(eq(devicesDevices.id, id)).limit(1).all(),
    )
  }

  async function requireDevice(id: string): Promise<Device> {
    const device = await findDevice(id)
    if (!device) throw new DevicesError('not_found', `Device ${id} does not exist.`)
    return device
  }

  async function findCredential(id: string): Promise<DeviceCredential | undefined> {
    return first(
      await db
        .select()
        .from(devicesCredentials)
        .where(eq(devicesCredentials.id, id))
        .limit(1)
        .all(),
    )
  }

  async function findSession(id: string): Promise<DeviceSession | undefined> {
    return first(
      await db.select().from(devicesSessions).where(eq(devicesSessions.id, id)).limit(1).all(),
    )
  }

  async function findChallenge(id: string): Promise<DeviceChallenge | undefined> {
    return first(
      await db.select().from(devicesChallenges).where(eq(devicesChallenges.id, id)).limit(1).all(),
    )
  }

  function sessionStartStatus(session: ClaimSession): ClaimStartStatus {
    if (session.status === 'pending_user_approval' && session.expiresAt <= now()) return 'expired'
    return session.status
  }

  async function prepareCredential(
    credentialClass: CredentialClass,
    version: number,
    expiresAt: number | null,
  ): Promise<{ issued: IssuedCredential; prepared: PreparedCredential }> {
    const secret = nextSecret()
    const id = nextId()
    const fingerprint = `sha256:${await sha256Hex(`${CREDENTIAL_FINGERPRINT_DOMAIN}${secret}`)}`
    const prepared: PreparedCredential = {
      id,
      credentialClass,
      secretHash: await sha256Hex(secret),
      fingerprint,
      version,
      expiresAt,
    }
    const issued: IssuedCredential = {
      credentialClass,
      credentialId: id,
      fingerprint,
      secret,
      version,
      ...(expiresAt === null ? {} : { expiresAt }),
    }
    return { issued, prepared }
  }

  async function revokeSessionsWhere(filter: SQL | undefined, revokedAt: number): Promise<number> {
    const revoked = await db
      .update(devicesSessions)
      .set({ revokedAt })
      .where(and(isNull(devicesSessions.revokedAt), filter))
      .returning({ id: devicesSessions.id })
      .all()
    return revoked.length
  }

  return {
    async createClaimToken(input) {
      const orgId = requireText(input.orgId, 'orgId')
      const createdByUserId = requireText(input.createdByUserId, 'createdByUserId')
      const resource = {
        kind: requireText(input.resource.kind, 'resource.kind'),
        id: requireText(input.resource.id, 'resource.id'),
      }
      const ttlSeconds = input.ttlSeconds ?? CLAIM_TOKEN_DEFAULT_TTL_SECONDS
      if (
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds <= 0 ||
        ttlSeconds > CLAIM_TOKEN_DEFAULT_TTL_SECONDS
      ) {
        throw new DevicesError(
          'invalid',
          `Claim token TTL must be a whole number of seconds in (0, ${CLAIM_TOKEN_DEFAULT_TTL_SECONDS}].`,
        )
      }

      const token = nextToken()
      if (token.length < CLAIM_TOKEN_MIN_LENGTH) {
        throw new DevicesError('invalid', 'The token generator produced fewer than 128 bits.')
      }
      const createdAt = now()
      const row: ClaimToken = {
        id: nextId(),
        orgId,
        resourceKind: resource.kind,
        resourceId: resource.id,
        tokenHash: await sha256Hex(token),
        expiresAt: createdAt + ttlSeconds * 1000,
        consumedAt: null,
        revokedAt: null,
        createdByUserId,
        createdAt,
      }
      await db.insert(devicesClaimTokens).values(row).run()
      await audit({
        orgId,
        actorUserId: createdByUserId,
        action: 'claim_token.create',
        subjectKind: 'claim_token',
        subjectId: row.id,
        details: { resourceKind: resource.kind, resourceId: resource.id, expiresAt: row.expiresAt },
      })
      // The raw token is returned exactly once; only its digest is stored.
      return { token, tokenId: row.id, expiresAt: row.expiresAt }
    },

    async revokeClaimToken(input) {
      const token = await findClaimToken(input.claimTokenId)
      if (!token) {
        throw new DevicesError('not_found', `Claim token ${input.claimTokenId} does not exist.`)
      }
      if (token.revokedAt !== null) return token
      const revokedAt = now()
      await db
        .update(devicesClaimTokens)
        .set({ revokedAt })
        .where(eq(devicesClaimTokens.id, token.id))
        .run()
      const sessions = await db
        .update(devicesClaimSessions)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(devicesClaimSessions.claimTokenId, token.id),
            eq(devicesClaimSessions.status, 'pending_user_approval'),
          ),
        )
        .returning({ id: devicesClaimSessions.id })
        .all()
      await audit({
        orgId: token.orgId,
        actorUserId: input.actorUserId,
        action: 'claim_token.revoke',
        subjectKind: 'claim_token',
        subjectId: token.id,
        details: {
          reason: input.reason ?? null,
          revokedClaimSessionIds: sessions.map((session) => session.id),
        },
      })
      return { ...token, revokedAt }
    },

    async startClaim(input) {
      const claimToken = requireText(input.claimToken, 'claimToken')
      const hardwareFingerprint = requireText(input.hardwareFingerprint, 'hardwareFingerprint')
      const fingerprintAlgorithm = requireText(
        input.hardwareFingerprintAlgorithm,
        'hardwareFingerprintAlgorithm',
      )
      const devicePublicKey = requireText(input.devicePublicKey, 'devicePublicKey')
      const softwareVersion = requireText(input.softwareVersion, 'softwareVersion')
      const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey')
      if (
        !isBase64Url(devicePublicKey) ||
        base64UrlDecode(devicePublicKey).length !== ED25519_PUBLIC_KEY_BYTES
      ) {
        throw new DevicesError('invalid', 'devicePublicKey must be a raw base64url Ed25519 key.')
      }

      const tokenHash = await sha256Hex(claimToken)
      const subjects: LockoutSubject[] = [
        { kind: 'token', subject: tokenHash },
        ...remoteSubjects(input.remote),
      ]
      const locked = await lockouts.check(subjects)
      if (locked) {
        return {
          claimSessionId: null,
          status: 'rate_limited',
          expiresAt: now() + locked.retryAfterSeconds * 1000,
          retryAfterSeconds: locked.retryAfterSeconds,
        }
      }

      const token = await findClaimTokenByHash(tokenHash)
      const fail = async (
        status: ClaimStartStatus,
        expiresAt: number,
        claimSessionId: string | null = null,
      ): Promise<StartClaimResult> => {
        await recordAttempt(subjects, 'failure', { orgId: token?.orgId ?? null, reason: status })
        return { claimSessionId, status, expiresAt }
      }

      // Idempotent replay: the same key with the same material returns the
      // original session state; the same key with different material is a
      // caller bug, not a claim outcome.
      const existing = first(
        await db
          .select()
          .from(devicesClaimSessions)
          .where(eq(devicesClaimSessions.idempotencyKey, idempotencyKey))
          .limit(1)
          .all(),
      )
      if (existing) {
        const existingToken = await findClaimToken(existing.claimTokenId)
        if (
          existingToken?.tokenHash !== tokenHash ||
          existing.hardwareFingerprint !== hardwareFingerprint
        ) {
          throw new DevicesError(
            'conflict',
            `Idempotency key ${idempotencyKey} was already used with different claim material.`,
          )
        }
        return {
          claimSessionId: existing.id,
          status: sessionStartStatus(existing),
          expiresAt: existing.expiresAt,
        }
      }

      if (claimToken.length < CLAIM_TOKEN_MIN_LENGTH || !token) return fail('invalid_token', now())

      // A token binds to the first hardware fingerprint that presents it. The
      // same device again with a fresh idempotency key gets the session it
      // already has (pending, claimed, expired or revoked) rather than a second.
      const priorSession = first(
        await db
          .select()
          .from(devicesClaimSessions)
          .where(eq(devicesClaimSessions.claimTokenId, token.id))
          .orderBy(desc(devicesClaimSessions.createdAt))
          .limit(1)
          .all(),
      )
      if (priorSession) {
        if (priorSession.hardwareFingerprint !== hardwareFingerprint) {
          return fail('hardware_mismatch', token.expiresAt)
        }
        return {
          claimSessionId: priorSession.id,
          status: sessionStartStatus(priorSession),
          expiresAt: priorSession.expiresAt,
        }
      }
      if (token.revokedAt !== null) return fail('revoked', token.expiresAt)
      if (token.expiresAt <= now()) return fail('expired', token.expiresAt)
      if (token.consumedAt !== null) return fail('revoked', token.expiresAt)

      // Device key reuse: a key already bound to a live device with different
      // hardware is not a new device (docs/09 G2 negative test).
      const keyHolder = first(
        await db
          .select({
            id: devicesDevices.id,
            hardwareFingerprint: devicesDevices.hardwareFingerprint,
          })
          .from(devicesDevices)
          .where(
            and(
              eq(devicesDevices.publicKey, devicePublicKey),
              eq(devicesDevices.status, 'claimed'),
            ),
          )
          .limit(1)
          .all(),
      )
      if (keyHolder && keyHolder.hardwareFingerprint !== hardwareFingerprint) {
        return fail('hardware_mismatch', token.expiresAt)
      }

      const createdAt = now()
      const session: ClaimSession = {
        id: nextId(),
        claimTokenId: token.id,
        idempotencyKey,
        hardwareFingerprint,
        fingerprintAlgorithm,
        publicKey: devicePublicKey,
        softwareVersion,
        status: 'pending_user_approval',
        expiresAt: token.expiresAt,
        completedAt: null,
        completionIdempotencyKey: null,
        deviceId: null,
        approvalTokenHash: null,
        approvalUserId: null,
        approvalOrgId: null,
        approvalResourceKind: null,
        approvalResourceId: null,
        approvalExpiresAt: null,
        createdAt,
      }
      await db.insert(devicesClaimSessions).values(session).run()
      await audit({
        orgId: token.orgId,
        action: 'claim.start',
        subjectKind: 'claim_session',
        subjectId: session.id,
        details: {
          claimTokenId: token.id,
          hardwareFingerprint,
          fingerprintAlgorithm,
          softwareVersion,
          expiresAt: session.expiresAt,
        },
      })
      await recordAttempt(subjects, 'success', { orgId: token.orgId })
      return {
        claimSessionId: session.id,
        status: 'pending_user_approval',
        expiresAt: session.expiresAt,
      }
    },

    async getClaimSession(claimSessionId) {
      return (await findClaimSession(claimSessionId)) ?? null
    },

    async issueApprovalToken(input) {
      const approvedByUserId = requireText(input.approvedByUserId, 'approvedByUserId')
      const session = await findClaimSession(input.claimSessionId)
      if (!session) {
        throw new DevicesError('not_found', `Claim session ${input.claimSessionId} does not exist.`)
      }
      if (session.status === 'claimed') {
        throw new DevicesError('conflict', `Claim session ${session.id} is already completed.`)
      }
      if (session.status === 'revoked') {
        throw new DevicesError('revoked', `Claim session ${session.id} was revoked.`)
      }
      if (session.status === 'expired' || session.expiresAt <= now()) {
        throw new DevicesError('expired', `Claim session ${session.id} expired.`)
      }
      const token = await findClaimToken(session.claimTokenId)
      if (!token)
        throw new DevicesError('not_found', 'The claim token behind this session is gone.')
      if (
        token.orgId !== input.orgId ||
        !sameResource({ kind: token.resourceKind, id: token.resourceId }, input.resource)
      ) {
        throw new DevicesError(
          'forbidden',
          'An approval must name the org and resource the claim token was minted for.',
        )
      }
      if (session.hardwareFingerprint !== input.hardwareFingerprint) {
        throw new DevicesError(
          'invalid',
          'The approved hardware fingerprint does not match the claim session.',
        )
      }
      const ttlMs = input.ttlSeconds === undefined ? approvalTtlMs : input.ttlSeconds * 1000
      const expiresAt = Math.min(now() + ttlMs, session.expiresAt)
      const approvalToken = nextToken()
      await db
        .update(devicesClaimSessions)
        .set({
          approvalTokenHash: await sha256Hex(approvalToken),
          approvalUserId: approvedByUserId,
          approvalOrgId: input.orgId,
          approvalResourceKind: input.resource.kind,
          approvalResourceId: input.resource.id,
          approvalExpiresAt: expiresAt,
        })
        .where(eq(devicesClaimSessions.id, session.id))
        .run()
      await audit({
        orgId: input.orgId,
        actorUserId: approvedByUserId,
        action: 'claim.approve',
        subjectKind: 'claim_session',
        subjectId: session.id,
        details: {
          resourceKind: input.resource.kind,
          resourceId: input.resource.id,
          hardwareFingerprint: input.hardwareFingerprint,
          expiresAt,
        },
      })
      return { token: approvalToken, expiresAt }
    },

    async completeClaim(input) {
      const approvedByUserId = requireText(input.approvedByUserId, 'approvedByUserId')
      const installationId = requireText(input.installationId, 'installationId')
      const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey')
      const session = await findClaimSession(input.claimSessionId)
      if (!session) {
        throw new DevicesError('not_found', `Claim session ${input.claimSessionId} does not exist.`)
      }
      const token = await findClaimToken(session.claimTokenId)
      if (!token)
        throw new DevicesError('not_found', 'The claim token behind this session is gone.')

      const subjects: LockoutSubject[] = [
        { kind: 'token', subject: token.tokenHash },
        { kind: 'account', subject: approvedByUserId },
        ...remoteSubjects(input.remote).filter((subject) => subject.kind !== 'account'),
      ]
      const locked = await lockouts.check(subjects)
      if (locked) {
        return {
          status: 'rate_limited',
          credentials: [],
          retryAfterSeconds: locked.retryAfterSeconds,
        }
      }

      const fail = async (status: ClaimCompleteStatus): Promise<CompleteClaimResult> => {
        await recordAttempt(subjects, 'failure', { orgId: token.orgId, reason: status })
        return { status, credentials: [] }
      }
      const alreadyCompleted = (completed: ClaimSession): CompleteClaimResult => ({
        status: 'already_completed',
        credentials: [],
        ...(completed.deviceId === null ? {} : { deviceId: completed.deviceId }),
      })

      if (session.status === 'claimed') return alreadyCompleted(session)
      if (session.status === 'revoked' || token.revokedAt !== null) return fail('revoked')
      if (session.status === 'expired' || session.expiresAt <= now()) {
        if (session.status !== 'expired') {
          await db
            .update(devicesClaimSessions)
            .set({ status: 'expired' })
            .where(
              and(
                eq(devicesClaimSessions.id, session.id),
                eq(devicesClaimSessions.status, 'pending_user_approval'),
              ),
            )
            .run()
        }
        return fail('expired')
      }
      if (session.hardwareFingerprint !== input.hardwareFingerprint)
        return fail('hardware_mismatch')
      if (
        token.orgId !== input.orgId ||
        !sameResource({ kind: token.resourceKind, id: token.resourceId }, input.resource)
      ) {
        return fail('unauthorized_user')
      }
      if (
        session.approvalTokenHash === null ||
        session.approvalExpiresAt === null ||
        session.approvalExpiresAt <= now() ||
        (await sha256Hex(input.userApprovalToken)) !== session.approvalTokenHash
      ) {
        return fail('approval_required')
      }
      if (
        session.approvalUserId !== approvedByUserId ||
        session.approvalOrgId !== input.orgId ||
        session.approvalResourceKind !== input.resource.kind ||
        session.approvalResourceId !== input.resource.id
      ) {
        return fail('unauthorized_user')
      }

      const completedAt = now()
      const deviceId = nextId()
      const ingest = await prepareCredential('ingest', 1, null)
      const command = await prepareCredential('command', 1, null)
      const won = await completeClaimAtomically(
        db,
        {
          claimSessionId: session.id,
          token,
          deviceId,
          installationId,
          approvedByUserId,
          idempotencyKey,
          completedAt,
          credentials: [ingest.prepared, command.prepared],
        },
        nextId,
      )
      if (!won) {
        const current = await findClaimSession(session.id)
        if (current?.status === 'claimed') return alreadyCompleted(current)
        if (current?.status === 'revoked') return fail('revoked')
        return fail('expired')
      }
      await recordAttempt(subjects, 'success', { orgId: token.orgId })
      // Secrets are returned exactly once; only their digests were stored.
      return { status: 'completed', deviceId, credentials: [ingest.issued, command.issued] }
    },

    async getDevice(deviceId) {
      return (await findDevice(deviceId)) ?? null
    },

    async listDevices(input) {
      const limit = Math.min(Math.max(input.limit ?? 100, 1), DEVICE_LIST_MAX_LIMIT)
      const filters: Array<SQL | undefined> = [eq(devicesDevices.orgId, input.orgId)]
      if (input.resource) {
        filters.push(
          eq(devicesDevices.resourceKind, input.resource.kind),
          eq(devicesDevices.resourceId, input.resource.id),
        )
      }
      if (!input.includeRevoked) filters.push(eq(devicesDevices.status, 'claimed'))
      return db
        .select()
        .from(devicesDevices)
        .where(and(...filters))
        .orderBy(desc(devicesDevices.claimedAt), desc(devicesDevices.id))
        .limit(limit)
        .all()
    },

    async issueChallenge(input) {
      const device = await requireDevice(input.deviceId)
      if (device.status !== 'claimed') {
        throw new DevicesError('revoked', `Device ${device.id} is revoked.`)
      }
      const createdAt = now()
      const challenge: DeviceChallenge = {
        id: nextId(),
        deviceId: device.id,
        nonce: nextToken(),
        expiresAt: createdAt + challengeTtlMs,
        createdAt,
      }
      await db.insert(devicesChallenges).values(challenge).run()
      await audit({
        orgId: device.orgId,
        action: 'challenge.issue',
        subjectKind: 'device',
        subjectId: device.id,
        details: { challengeId: challenge.id, expiresAt: challenge.expiresAt },
      })
      return { challengeId: challenge.id, nonce: challenge.nonce, expiresAt: challenge.expiresAt }
    },

    async openSession(input) {
      const { canonicalRequest: request } = input
      const subjects: LockoutSubject[] = [
        { kind: 'device', subject: input.deviceId },
        ...remoteSubjects(input.remote),
      ]
      const locked = await lockouts.check(subjects)
      if (locked) {
        throw new DevicesError('rate_limited', 'Too many failed session attempts.', {
          retryAfterSeconds: locked.retryAfterSeconds,
        })
      }

      const device = await findDevice(input.deviceId)
      const fail = async (
        code: 'unauthorized' | 'forbidden' | 'revoked',
        reason: string,
      ): Promise<never> => {
        await recordAttempt(subjects, 'failure', { orgId: device?.orgId ?? null, reason })
        throw new DevicesError(code, `Session open refused: ${reason}.`)
      }

      if (!device) return fail('unauthorized', 'unknown device')
      if (device.status !== 'claimed') return fail('revoked', 'device revoked')

      const credential = await findCredential(input.credentialId)
      if (
        !credential ||
        credential.deviceId !== device.id ||
        credential.revokedAt !== null ||
        (credential.expiresAt !== null && credential.expiresAt <= now())
      ) {
        return fail('unauthorized', 'credential not active')
      }
      // Class separation: an ingest credential never opens a command session.
      if (credential.credentialClass !== input.credentialClass) {
        return fail('forbidden', 'credential class mismatch')
      }
      if (
        request.deviceId !== device.id ||
        request.credentialVersion !== credential.version ||
        request.installationId !== device.installationId ||
        !sameResource(request.resource, { kind: device.resourceKind, id: device.resourceId })
      ) {
        return fail('unauthorized', 'request binding mismatch')
      }
      if (!Number.isFinite(request.timestamp) || Math.abs(request.timestamp - now()) > skewMs) {
        return fail('unauthorized', 'timestamp outside skew window')
      }
      const challenge = await findChallenge(request.challengeId)
      if (!challenge || challenge.deviceId !== device.id || challenge.expiresAt <= now()) {
        return fail('unauthorized', 'challenge not active')
      }
      if (!isBase64Url(input.signature)) return fail('unauthorized', 'malformed signature')
      const verified = await verifySignature({
        message: canonicalBytes(request as unknown as CanonicalValue),
        publicKey: base64UrlDecode(device.publicKey),
        signature: base64UrlDecode(input.signature),
      })
      if (!verified) return fail('unauthorized', 'signature mismatch')

      const replay = await db
        .insert(devicesReplayEntries)
        .values({
          id: nextId(),
          deviceId: device.id,
          credentialVersion: credential.version,
          challengeId: challenge.id,
          nonce: request.nonce,
          requestHash: request.requestHash,
          expiresAt: challenge.expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: devicesReplayEntries.id })
        .all()
      if (replay.length === 0) return fail('unauthorized', 'replayed request')

      const createdAt = now()
      const session: DeviceSession = {
        id: nextId(),
        deviceId: device.id,
        credentialId: credential.id,
        credentialClass: credential.credentialClass,
        challengeId: challenge.id,
        nonce: request.nonce,
        expiresAt: createdAt + sessionTtlMs,
        revokedAt: null,
        revocationGeneration: device.revocationGeneration,
        lastSeenAt: createdAt,
        createdAt,
      }
      await db.insert(devicesSessions).values(session).run()
      await audit({
        orgId: device.orgId,
        action: 'session.open',
        subjectKind: 'session',
        subjectId: session.id,
        details: {
          deviceId: device.id,
          credentialId: credential.id,
          credentialClass: credential.credentialClass,
          credentialVersion: credential.version,
          challengeId: challenge.id,
          expiresAt: session.expiresAt,
          revocationGeneration: session.revocationGeneration,
        },
      })
      await recordAttempt(subjects, 'success', { orgId: device.orgId })
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        revocationGeneration: session.revocationGeneration,
      }
    },

    async getSession(sessionId) {
      const session = await findSession(sessionId)
      if (!session || session.revokedAt !== null || session.expiresAt <= now()) return null
      return session
    },

    async heartbeat(input) {
      const session = await findSession(input.sessionId)
      if (!session)
        throw new DevicesError('not_found', `Session ${input.sessionId} does not exist.`)
      if (session.revokedAt !== null) {
        throw new DevicesError('revoked', `Session ${session.id} was revoked.`)
      }
      if (session.expiresAt <= now()) {
        throw new DevicesError('expired', `Session ${session.id} expired.`)
      }
      const device = await requireDevice(session.deviceId)
      // Liveness only: no audit row, and no expiry extension — a session ends
      // at `expiresAt` and the device opens a fresh one.
      await db
        .update(devicesSessions)
        .set({ lastSeenAt: now() })
        .where(eq(devicesSessions.id, session.id))
        .run()
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        revocationGeneration: session.revocationGeneration,
        deviceRevocationGeneration: device.revocationGeneration,
        stale:
          device.status !== 'claimed' || device.revocationGeneration > session.revocationGeneration,
      }
    },

    async revokeSession(input) {
      const session = await findSession(input.sessionId)
      if (!session)
        throw new DevicesError('not_found', `Session ${input.sessionId} does not exist.`)
      if (session.revokedAt !== null) return session
      const revokedAt = now()
      await revokeSessionsWhere(eq(devicesSessions.id, session.id), revokedAt)
      const device = await findDevice(session.deviceId)
      await audit({
        orgId: device?.orgId ?? null,
        actorUserId: input.actorUserId,
        action: 'session.revoke',
        subjectKind: 'session',
        subjectId: session.id,
        details: { deviceId: session.deviceId, reason: input.reason ?? null },
      })
      return { ...session, revokedAt }
    },

    async revokeDevice(input) {
      const device = await requireDevice(input.deviceId)
      if (device.status === 'revoked') return device
      const revokedAt = now()
      const revocationGeneration = device.revocationGeneration + 1
      await db
        .update(devicesDevices)
        .set({ status: 'revoked', revokedAt, revocationGeneration })
        .where(eq(devicesDevices.id, device.id))
        .run()
      await db
        .update(devicesCredentials)
        .set({ revokedAt })
        .where(
          and(eq(devicesCredentials.deviceId, device.id), isNull(devicesCredentials.revokedAt)),
        )
        .run()
      const revokedSessions = await revokeSessionsWhere(
        eq(devicesSessions.deviceId, device.id),
        revokedAt,
      )
      await audit({
        orgId: device.orgId,
        actorUserId: input.actorUserId,
        action: 'device.revoke',
        subjectKind: 'device',
        subjectId: device.id,
        details: { reason: input.reason ?? null, revocationGeneration, revokedSessions },
      })
      return { ...device, status: 'revoked', revokedAt, revocationGeneration }
    },

    async rotateCredential(input) {
      const device = await requireDevice(input.deviceId)
      if (device.status !== 'claimed') {
        throw new DevicesError('revoked', `Device ${device.id} is revoked.`)
      }
      const expiresAt = input.expiresAt ?? null
      if (expiresAt !== null) requirePositiveInteger(expiresAt, 'expiresAt')
      const current = await db
        .select()
        .from(devicesCredentials)
        .where(
          and(
            eq(devicesCredentials.deviceId, device.id),
            eq(devicesCredentials.credentialClass, input.credentialClass),
          ),
        )
        .orderBy(desc(devicesCredentials.version))
        .limit(1)
        .all()
      const version = (first(current)?.version ?? 0) + 1
      const rotatedAt = now()
      const revocationGeneration = device.revocationGeneration + 1
      const { issued, prepared } = await prepareCredential(
        input.credentialClass,
        version,
        expiresAt,
      )

      await db
        .update(devicesCredentials)
        .set({ revokedAt: rotatedAt })
        .where(
          and(
            eq(devicesCredentials.deviceId, device.id),
            eq(devicesCredentials.credentialClass, input.credentialClass),
            isNull(devicesCredentials.revokedAt),
          ),
        )
        .run()
      await db
        .insert(devicesCredentials)
        .values({
          id: prepared.id,
          deviceId: device.id,
          credentialClass: prepared.credentialClass,
          secretHash: prepared.secretHash,
          fingerprint: prepared.fingerprint,
          version: prepared.version,
          issuedAt: rotatedAt,
          expiresAt: prepared.expiresAt,
          revokedAt: null,
        })
        .run()
      await db
        .update(devicesDevices)
        .set({ revocationGeneration })
        .where(eq(devicesDevices.id, device.id))
        .run()
      const revokedSessions = await revokeSessionsWhere(
        and(
          eq(devicesSessions.deviceId, device.id),
          eq(devicesSessions.credentialClass, input.credentialClass),
        ),
        rotatedAt,
      )
      await audit({
        orgId: device.orgId,
        actorUserId: input.actorUserId,
        action: 'credential.rotate',
        subjectKind: 'credential',
        subjectId: prepared.id,
        details: {
          deviceId: device.id,
          credentialClass: input.credentialClass,
          version,
          revocationGeneration,
          revokedSessions,
          reason: input.reason ?? null,
        },
      })
      // The new secret is returned exactly once.
      return issued
    },

    async verifyCredentialSecret(input) {
      const credential = await findCredential(input.credentialId)
      if (
        !credential ||
        credential.revokedAt !== null ||
        (credential.expiresAt !== null && credential.expiresAt <= now())
      ) {
        return null
      }
      return (await sha256Hex(input.secret)) === credential.secretHash ? credential : null
    },

    async listAuditEvents(input = {}) {
      const limit = Math.min(
        Math.max(input.limit ?? AUDIT_EVENTS_DEFAULT_LIMIT, 1),
        AUDIT_EVENTS_MAX_LIMIT,
      )
      const filters: Array<SQL | undefined> = []
      if (input.orgId !== undefined) filters.push(eq(devicesAuditEvents.orgId, input.orgId))
      if (input.subject) {
        filters.push(
          eq(devicesAuditEvents.subjectKind, input.subject.kind),
          eq(devicesAuditEvents.subjectId, input.subject.id),
        )
      }
      if (typeof input.before === 'number') {
        filters.push(lt(devicesAuditEvents.createdAt, input.before))
      }
      return db
        .select()
        .from(devicesAuditEvents)
        .where(and(...filters))
        .orderBy(desc(devicesAuditEvents.createdAt), desc(devicesAuditEvents.id))
        .limit(limit)
        .all()
    },
  }
}
