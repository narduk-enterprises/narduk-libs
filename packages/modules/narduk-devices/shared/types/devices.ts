/**
 * Resources are generic on purpose, exactly as in narduk-tenancy: this package
 * stores a `kind` plus an opaque `id` and never resolves either. The first
 * consumer maps `kind: 'vessel'`.
 */
export interface DevicesResourceRef {
  id: string
  kind: string
}

/** The two credential classes. `ingest` never opens a `command` session. */
export const CREDENTIAL_CLASSES = ['ingest', 'command'] as const
export type CredentialClass = (typeof CREDENTIAL_CLASSES)[number]

export const DEVICE_STATUSES = ['claimed', 'revoked'] as const
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

/**
 * Wire vocabularies, exactly the consumer's `ClaimStartStatus` and
 * `ClaimCompleteStatus` enums. A claim session row persists only the subset in
 * `CLAIM_SESSION_STATUSES`; the remaining values describe one attempt's
 * outcome and are computed, never stored.
 */
export const CLAIM_START_STATUSES = [
  'pending_user_approval',
  'claimed',
  'expired',
  'revoked',
  'rate_limited',
  'hardware_mismatch',
  'invalid_token',
] as const
export type ClaimStartStatus = (typeof CLAIM_START_STATUSES)[number]

export const CLAIM_COMPLETE_STATUSES = [
  'completed',
  'already_completed',
  'expired',
  'revoked',
  'hardware_mismatch',
  'approval_required',
  'unauthorized_user',
  'rate_limited',
] as const
export type ClaimCompleteStatus = (typeof CLAIM_COMPLETE_STATUSES)[number]

export const CLAIM_SESSION_STATUSES = [
  'pending_user_approval',
  'claimed',
  'expired',
  'revoked',
] as const
export type ClaimSessionStatus = (typeof CLAIM_SESSION_STATUSES)[number]

export const AUTH_ATTEMPT_SUBJECT_KINDS = ['token', 'device', 'account', 'ip'] as const
export type AuthAttemptSubjectKind = (typeof AUTH_ATTEMPT_SUBJECT_KINDS)[number]

export const AUTH_ATTEMPT_OUTCOMES = ['success', 'failure'] as const
export type AuthAttemptOutcome = (typeof AUTH_ATTEMPT_OUTCOMES)[number]

export interface Device {
  claimedAt: number
  createdAt: number
  fingerprintAlgorithm: string
  hardwareFingerprint: string
  id: string
  installationId: string
  orgId: string
  /** Base64url (unpadded) raw Ed25519 public key generated on the device. */
  publicKey: string
  resourceId: string
  resourceKind: string
  /** Bumped by `revokeDevice` and `rotateCredential`; sessions snapshot it. */
  revocationGeneration: number
  revokedAt: number | null
  softwareVersion: string
  status: DeviceStatus
}

export interface ClaimToken {
  consumedAt: number | null
  /**
   * The claim session that redeemed this token. A token is consumed the moment
   * `startClaim` binds it to a session, so completion can refuse a token whose
   * consumption belongs to a different session.
   */
  consumedByClaimSessionId: string | null
  createdAt: number
  createdByUserId: string
  expiresAt: number
  id: string
  orgId: string
  resourceId: string
  resourceKind: string
  revokedAt: number | null
  tokenHash: string
}

export interface ClaimSession {
  approvalExpiresAt: number | null
  approvalOrgId: string | null
  approvalResourceId: string | null
  approvalResourceKind: string | null
  approvalTokenHash: string | null
  approvalUserId: string | null
  claimTokenId: string
  completedAt: number | null
  completionIdempotencyKey: string | null
  createdAt: number
  deviceId: string | null
  expiresAt: number
  fingerprintAlgorithm: string
  hardwareFingerprint: string
  id: string
  idempotencyKey: string
  publicKey: string
  softwareVersion: string
  status: ClaimSessionStatus
}

export interface DeviceCredential {
  credentialClass: CredentialClass
  deviceId: string
  expiresAt: number | null
  fingerprint: string
  id: string
  issuedAt: number
  revokedAt: number | null
  secretHash: string
  version: number
}

/**
 * `id` is a non-bearer row id, safe to log and to name in an audit row. The
 * bearer is a separate random token returned exactly once by `openSession`;
 * only its SHA-256 digest is stored, in `tokenHash`.
 */
export interface DeviceSession {
  challengeId: string
  createdAt: number
  credentialClass: CredentialClass
  credentialId: string
  deviceId: string
  expiresAt: number
  id: string
  lastSeenAt: number
  nonce: string
  revocationGeneration: number
  revokedAt: number | null
  /** SHA-256 of the bearer session token; the token itself is never stored. */
  tokenHash: string
}

export interface DeviceChallenge {
  createdAt: number
  deviceId: string
  expiresAt: number
  id: string
  nonce: string
}

export interface DeviceAuthAttempt {
  at: number
  id: string
  outcome: AuthAttemptOutcome
  subject: string
  subjectKind: AuthAttemptSubjectKind
}

export interface DevicesAuditEvent {
  action: string
  actorUserId: string | null
  createdAt: number
  detailsJson: string
  id: string
  orgId: string | null
  subjectId: string
  subjectKind: string
}

/** Issued exactly once; `secret` is never stored in the clear. */
export interface IssuedCredential {
  credentialClass: CredentialClass
  credentialId: string
  expiresAt?: number
  fingerprint: string
  secret: string
  version: number
}

/**
 * Field set the first consumer's `IssuedCredentialSchema` accepts on the wire:
 * `credentialClass`, `credentialId`, `fingerprint`, `secret`, optional
 * `expiresAt`. `version` stays on {@link IssuedCredential} — it is part of the
 * signed session request and makes a rotation observable — and is stripped
 * here once so each response call site does not have to.
 */
export interface WireCredential {
  credentialClass: CredentialClass
  credentialId: string
  expiresAt?: number
  fingerprint: string
  secret: string
}

/**
 * Project an issued credential onto the consumer wire field set. Call this
 * over `completeClaim` / `rotateCredential` output before putting it on a
 * response body; those methods still return {@link IssuedCredential}.
 */
export function toWireCredential(issued: IssuedCredential): WireCredential {
  const wire: WireCredential = {
    credentialClass: issued.credentialClass,
    credentialId: issued.credentialId,
    fingerprint: issued.fingerprint,
    secret: issued.secret,
  }
  if (issued.expiresAt !== undefined) {
    wire.expiresAt = issued.expiresAt
  }
  return wire
}

/**
 * Every mutation this package performs writes exactly one audit row with one
 * of these actions, plus `security.lockout` when an account or IP crosses the
 * escalating threshold. No SQL CHECK on the column: migrations are additive.
 */
export const DEVICES_AUDIT_ACTIONS = [
  'claim_token.create',
  'claim_token.revoke',
  'claim.start',
  'claim.approve',
  'claim.complete',
  'claim.reissue',
  'challenge.issue',
  'session.open',
  'session.revoke',
  'device.revoke',
  'credential.rotate',
  'security.lockout',
] as const
export type DevicesAuditAction = (typeof DEVICES_AUDIT_ACTIONS)[number]

/**
 * The scope prefix this package reserves in `devices_scoped_nonces` for its own
 * single-use rows: the completion-proof nonce
 * (`narduk-devices:claim-completion:<claimSessionId>`) and the re-issue
 * single-writer lock (`narduk-devices:reissue:<deviceId>`). `consumeNonce`
 * refuses a caller scope that starts with it, so an application can never
 * write — or pre-empt — a row the library depends on
 * (narduk-libs#228 second review H3).
 */
export const DEVICES_INTERNAL_NONCE_PREFIX = 'narduk-devices:'
