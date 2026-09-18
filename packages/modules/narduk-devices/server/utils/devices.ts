import { and, desc, eq, isNull, lt, lte } from 'drizzle-orm'

import { CREDENTIAL_CLASSES, DEVICES_INTERNAL_NONCE_PREFIX } from '../../shared/types/devices'
import { DEVICES_LOCKOUT_POLICY } from '../../shared/utils/lockout-policy'
import {
  devicesAuditEvents,
  devicesAuthAttempts,
  devicesChallenges,
  devicesClaimSessions,
  devicesClaimTokens,
  devicesCredentials,
  devicesDevices,
  devicesReplayEntries,
  devicesScopedNonces,
  devicesSessions,
} from '../database/devices-schema'

import {
  completeClaimAtomically,
  type PreparedCredential,
  reissueCredentialsAtomically,
  type ReissueOutcome,
  type ScopedNonceRef,
} from './devices-complete-claim'
import { DevicesError } from './devices-error'
import {
  createLockoutGate,
  DEVICES_LOCKOUT_MAX_WINDOW_SECONDS,
  type LockoutPurpose,
  type LockoutSubject,
  lockoutSubjectFor,
} from './devices-lockout'
import { revokeDeviceAtomically, rotateCredentialAtomically } from './devices-revocation'
import {
  canonicalBytes,
  type CanonicalValue,
  ED25519_PUBLIC_KEY_BYTES,
  randomBase64Url,
  sha256Hex,
  type SignatureVerifier,
  timingSafeEqualHex,
  tryBase64UrlDecode,
  verifyEd25519,
} from './devices-signing'
import { startClaimAtomically } from './devices-start-claim'

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

/**
 * How many times one claim session's completion may be replayed into a fresh
 * credential set (Logan's per-session cap, 2026-09-10).
 *
 * This is a bound on churn and audit noise, *not* the control that makes the
 * re-issue path safe: one re-issue is already a complete credential set, so a
 * cap on its own would only turn unlimited takeover into N takeovers. Safety
 * comes from `deviceProof` — the Ed25519 signature, request binding and
 * single-use nonce `completeClaimWithRecordedApproval` requires before it will
 * re-issue at all (narduk-libs#228 review H1). The cap sits on top of that.
 */
export const MAX_REISSUES_PER_CLAIM_SESSION = 3

/**
 * The window a caller that lost the re-issue compare-and-swap is told to wait
 * within. The loser is a device replaying its *own* completion, so the answer
 * has to be retryable: a terminal status there bricks a device whose
 * credentials the winning attempt already rotated (narduk-libs#228 review H3).
 */
export const REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN = 2
export const REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX = 5

/**
 * What a caller that lost the re-issue compare-and-swap is told to wait.
 *
 * Jittered across a small window rather than fixed. A constant hint is not a
 * leak — it carries nothing about the winner — but a fixed one second on a boat
 * uplink mostly guarantees the same two callers collide again
 * (narduk-libs#228 second review L2). `random` must be uniform on `[0, 1)`; the
 * value it produces is a scheduling hint, never a security parameter, and is
 * drawn from nothing the request contains.
 */
export function reissueRetryAfterSeconds(random: () => number = Math.random): number {
  const span =
    REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MAX - REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN
  const offset = Math.min(Math.max(random(), 0), 0.999_999_999)
  return REISSUE_CONTENTION_RETRY_AFTER_SECONDS_MIN + Math.floor(offset * (span + 1))
}

/**
 * The longest life `consumeNonce` will accept for a caller-supplied nonce.
 *
 * `pruneExpired` reclaims a scoped nonce only once its `expiresAt` has passed,
 * so an unbounded expiry is an unprunable row in a table this package now
 * depends on for its own locking (narduk-libs#228 second review L3). Refused
 * loudly rather than clamped: silently shortening a caller's replay window
 * would re-open replay for that caller without telling it.
 *
 * Seven days, not a tight bound: the job is to keep a row *reachable* by the
 * prune, not to police retention. A consumer holding a claim-handoff nonce for
 * a day past its claim session is well inside it; the wedge this refuses wrote
 * rows ten years out.
 */
export const SCOPED_NONCE_MAX_TTL_SECONDS = 604_800

/** Where one claim session's completion proofs are single-use. */
function completionNonceScope(claimSessionId: string): string {
  return `${DEVICES_INTERNAL_NONCE_PREFIX}claim-completion:${claimSessionId}`
}

const CREDENTIAL_FINGERPRINT_DOMAIN = 'narduk-devices:credential-fingerprint:'

/**
 * Is a signed request's timestamp inside the accepted skew window?
 *
 * `timestamp` and `now` are millisecond epochs; `seconds` is the half-width of
 * the window in seconds, so the default accepts +/-5 minutes. `openSession`
 * and the `deviceProof` check both call exactly this function, so a consumer
 * running its own signed exchange before any device session exists — a claim
 * handoff, for instance — bounds skew identically instead of re-deriving the
 * rule. `tests/devices-session.test.ts` pins the two together at the boundary.
 */
export function isWithinTimestampSkew(
  timestamp: number,
  now: number,
  seconds: number = TIMESTAMP_SKEW_DEFAULT_SECONDS,
): boolean {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new DevicesError('invalid', 'The skew window must be a non-negative number of seconds.')
  }
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return false
  return Math.abs(timestamp - now) <= seconds * 1000
}

/**
 * `isWithinTimestampSkew` as a guard: refuses with `unauthorized`, the same
 * code `openSession` throws for a request outside the window. The message
 * carries neither timestamp, so it stays loggable verbatim.
 */
export function assertTimestampSkew(
  timestamp: number,
  now: number,
  seconds: number = TIMESTAMP_SKEW_DEFAULT_SECONDS,
): void {
  if (!isWithinTimestampSkew(timestamp, now, seconds)) {
    throw new DevicesError(
      'unauthorized',
      'The request timestamp is outside the accepted skew window.',
    )
  }
}

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

/**
 * Does the *signed* request name the device and credential the database
 * resolved? Every field here is inside the signature and every comparison is
 * against a row, never against the caller's unsigned envelope: rewriting
 * `credentialClass` / `credentialId` on a captured signed body to ask for a
 * different credential fails here (narduk-libs#212 review finding 1).
 */
function requestBindsTo(
  request: CanonicalSessionRequest,
  device: Device,
  credential: DeviceCredential,
): boolean {
  return (
    request.deviceId === device.id &&
    request.installationId === device.installationId &&
    request.credentialId === credential.id &&
    request.credentialClass === credential.credentialClass &&
    request.credentialVersion === credential.version &&
    sameResource(request.resource, { kind: device.resourceKind, id: device.resourceId })
  )
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
  /**
   * Serve a replay of an already-completed claim carrying this exact
   * `idempotencyKey`, inside the claim session's remaining lifetime, with a
   * fresh equivalent credential set rather than `already_completed` and an
   * empty array. Default `false` on both completion paths.
   *
   * Re-issuing **rotates the device's live credentials and revokes every
   * session opened with the superseded ones**, so enabling it hands whoever
   * satisfies `canReissue` the device's only working credential set. On this
   * path the raw approval token is that proof; on
   * `completeClaimWithRecordedApproval` a `deviceProof` is required. Either
   * way, authenticate the caller before you turn it on.
   */
  reissueOnIdempotentReplay?: boolean
  remote?: RemoteContext
  resource: DevicesResourceRef
  userApprovalToken: string
}

/**
 * The bytes a device signs to prove, to this library, that it holds the private
 * key its claim session recorded.
 *
 * Canonical JSON, exactly like `CanonicalSessionRequest`: sorted keys, no
 * whitespace, UTF-8 (`canonicalBytes`). Every field is bound to resolved state
 * or to the completion request itself, so a captured proof cannot be re-aimed
 * at a different session, device, installation or idempotency key; `nonce` is
 * burned in `devices_scoped_nonces` on first use, so the capture cannot be
 * replayed either.
 *
 * "First use" means *first served use*. On the re-issue path the burn happens
 * inside the winning transaction, gated on the single-writer lock, so a caller
 * that loses the race or is refused before the batch has spent nothing and may
 * resend the identical bytes after `retryAfterSeconds`. A device only needs a
 * fresh `nonce` once a re-issue was actually served on this one
 * (narduk-libs#228 second review H2).
 */
export interface CanonicalCompletionRequest {
  claimSessionId: string
  /** Base64url raw Ed25519 key; must equal the key the claim session recorded. */
  devicePublicKey: string
  hardwareFingerprint: string
  idempotencyKey: string
  installationId: string
  /** Single use, per claim session. Any unguessable value the device picks. */
  nonce: string
  /** Millisecond epoch; must be inside `timestampSkewSeconds` of server time. */
  timestamp: number
}

/** A device's Ed25519 proof over `canonicalBytes(canonicalRequest)`. */
export interface DeviceCompletionProof {
  canonicalRequest: CanonicalCompletionRequest
  /** Base64url signature; verified against the claim session's recorded key. */
  signature: string
}

/**
 * Completion driven by the *device*, on the strength of the approval already
 * recorded on the claim session by `issueApprovalToken`.
 *
 * `completeClaim` needs the raw approval token, which forces any ceremony where
 * the device collects its own credentials to persist an approval bearer in the
 * clear between the two legs. This input needs no bearer at all: the approval
 * columns on the row are the authorization, the device is bound by the public
 * key it presents, and the org and resource are read from the claim token
 * rather than supplied by the caller.
 *
 * **Authenticate the device first.** `claimSessionId`, `devicePublicKey`,
 * `hardwareFingerprint` and `idempotencyKey` all travel on the wire, so on
 * their own they are not a secret: without `deviceProof` this call proves only
 * that the caller knows the values the handoff carried. Either pass
 * `deviceProof` and let the library verify the device, or verify the signed
 * request yourself before calling (narduk-libs#228 review H1).
 */
export interface CompleteClaimWithRecordedApprovalInput {
  claimSessionId: string
  /**
   * The device's signature over this request, verified in-library against the
   * key the claim session recorded, bound to every field below, and single-use.
   * Optional for a first completion; **required** for
   * `reissueOnIdempotentReplay`, which rotates live credentials.
   */
  deviceProof?: DeviceCompletionProof
  /** Base64url raw Ed25519 key; must equal the key the claim session recorded. */
  devicePublicKey: string
  hardwareFingerprint: string
  idempotencyKey: string
  installationId: string
  /**
   * Serve a replay of this completion with a fresh equivalent credential set.
   * Default `false`, and refused outright without `deviceProof`: a re-issue
   * revokes the genuine device's credentials and sessions, so a caller that
   * has proved nothing must never be able to trigger one.
   *
   * Past the binding check the caller is authenticated, so no outcome of a
   * replay advances a lockout counter — a device retrying a lost response
   * cannot lock itself out. A contended replay answers `rate_limited` with a
   * jittered `retryAfterSeconds` and may be resent verbatim; at
   * `MAX_REISSUES_PER_CLAIM_SESSION` it answers `already_completed` with an
   * empty array and no `deviceId` (narduk-libs#228 second review H2, M4).
   */
  reissueOnIdempotentReplay?: boolean
  remote?: RemoteContext
}

export interface CompleteClaimResult {
  /**
   * Live secrets, returned exactly once. A first completion returns them; so
   * does a re-issued replay (`status: 'completed'`, a *fresh* set at the next
   * version, the superseded one revoked). Every other status returns `[]`.
   */
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
 *
 * The credential is *inside* the signature: `credentialId`, `credentialClass`
 * and `credentialVersion` are all signed and all compared against the resolved
 * credential row, so a signed `ingest` body cannot be resubmitted as a
 * `command` request by rewriting the unsigned envelope (narduk-libs#212 review
 * finding 1). The exact sorted key list is in the README, for the Go edge.
 */
export interface CanonicalSessionRequest {
  challengeId: string
  credentialClass: CredentialClass
  credentialId: string
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
  /** Envelope copy of the signed class; the signed value is what is trusted. */
  credentialClass: CredentialClass
  /** Envelope copy of the signed credential id; the signed value is trusted. */
  credentialId: string
  deviceId: string
  remote?: RemoteContext
  /** Base64url Ed25519 signature over `canonicalBytes(canonicalRequest)`. */
  signature: string
}

export interface OpenSessionResult {
  expiresAt: number
  revocationGeneration: number
  /** Non-bearer row id: safe to log, names the session in the audit trail. */
  sessionId: string
  /** The bearer, returned exactly once; only its SHA-256 digest is stored. */
  sessionToken: string
}

/**
 * How a session is named. A device path presents the bearer it was given
 * (`sessionToken`, resolved by digest); an operator path names the row id.
 * Exactly one of the two.
 */
export interface SessionById {
  sessionId: string
  sessionToken?: never
}

export interface SessionByToken {
  sessionId?: never
  sessionToken: string
}

export type SessionSelector = SessionById | SessionByToken

export interface HeartbeatResult {
  /** The device's current generation; greater than the session's means re-open. */
  deviceRevocationGeneration: number
  expiresAt: number
  revocationGeneration: number
  sessionId: string
  stale: boolean
}

export interface PruneExpiredResult {
  authAttempts: number
  replayEntries: number
  scopedNonces: number
}

/**
 * A single-use nonce for a signed exchange this package does not itself model
 * — the leg before any device session exists.
 */
/**
 * A `RemoteContext` that actually resolves to a lockout subject.
 *
 * `remoteSubjects({})` is the empty list, so an options bag that merely *has* a
 * `remote` key can still be blind. Requiring one of the two fields at the type
 * level makes the blind case a compile error rather than a silent one
 * (narduk-libs#228 second review M1).
 */
export type AttributableRemoteContext =
  (RemoteContext & { accountKey: string }) | (RemoteContext & { ip: string })

/**
 * Who a failed bare-secret resolution is counted against. Required, and with no
 * default: a caller must either name a subject or say out loud that it has
 * none, because an unattributed lookup silently disables the whole sweep
 * counter (narduk-libs#228 second review M1).
 */
export type CredentialSecretLookupOptions =
  | { remote: AttributableRemoteContext; unattributed?: never }
  | { remote?: never; unattributed: true }

export interface ConsumeNonceInput {
  /**
   * Millisecond epoch after which the nonce may be forgotten by `pruneExpired`.
   * At most `SCOPED_NONCE_MAX_TTL_SECONDS` ahead of now; further out is refused
   * with `DevicesError('invalid')`, because a row the prune can never reach is
   * permanent (narduk-libs#228 second review L3).
   */
  expiresAt: number
  nonce: string
  /**
   * Opaque to this package, with one reservation: a scope starting with
   * `DEVICES_INTERNAL_NONCE_PREFIX` (`narduk-devices:`) is refused, because the
   * package writes its own completion-proof and re-issue-lock rows under that
   * prefix in the same table. Namespace yours so two exchanges cannot collide,
   * for example `claim-handoff:<claimSessionId>`.
   */
  scope: string
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

/**
 * What both completion methods answer for a `claimSessionId` that does not
 * exist — deliberately **two** outcomes, not one.
 *
 * - Normally the call **throws** `DevicesError('not_found')`. That is the
 *   documented contract for an unknown id and has not changed.
 * - Once the caller's own subjects are locked, the call **returns**
 *   `{ status: 'rate_limited', credentials: [], retryAfterSeconds }` instead —
 *   the same answer a real but locked session gets, so past the threshold the
 *   response stops distinguishing a real id from an invented one.
 *
 * Be explicit about what that is and is not: it is **rate-limiting on
 * enumeration**, not a uniform refusal. Below the threshold the two answers
 * still differ, so the first `perAccountOrIp.failures` probes do tell a real id
 * from an invented one; what changed is that they are counted, audited, and
 * eventually refused rather than free and untraced (narduk-libs#228 second
 * review L1, third review LOW-5).
 *
 * Uniformity was considered and rejected: answering `rate_limited` always would
 * break the `not_found` contract every existing consumer branches on, and
 * answering `not_found` always would hand the enumeration oracle straight back.
 * Handle both outcomes — a `catch` for `not_found` and a `rate_limited` status
 * check — on any route that accepts a caller-supplied `claimSessionId`.
 *
 * The counter behind it is namespaced `claim:` and is not the one
 * `getCredentialBySecret` reads (third review HIGH-4).
 */
export interface DevicesService {
  /**
   * Complete a claim with the raw approval bearer.
   *
   * An unknown `claimSessionId` is bimodal: see the note above this interface.
   */
  completeClaim: (input: CompleteClaimInput) => Promise<CompleteClaimResult>
  /**
   * Complete a claim from the device side, using the approval recorded on the
   * claim session. No raw approval token is required, so no approval bearer
   * ever has to be persisted by the consumer.
   *
   * An unknown `claimSessionId` is bimodal: see the note above this interface.
   *
   * **Authenticate the device before, or with, this call.** Every value it
   * compares travels on the wire; pass `deviceProof` to have the library
   * verify the device's Ed25519 signature, bind it to this request and burn its
   * nonce, or verify the signed request yourself first. `deviceProof` is
   * mandatory for `reissueOnIdempotentReplay`, which rotates live credentials
   * and revokes the device's sessions (narduk-libs#228 review H1).
   */
  completeClaimWithRecordedApproval: (
    input: CompleteClaimWithRecordedApprovalInput,
  ) => Promise<CompleteClaimResult>
  /**
   * Claim a single-use nonce for an arbitrary signed exchange. `true` is a
   * first presentation, `false` a replay. Backed by the same
   * insert-or-conflict check `openSession` uses, over `devices_scoped_nonces`.
   */
  consumeNonce: (input: ConsumeNonceInput) => Promise<boolean>
  createClaimToken: (input: CreateClaimTokenInput) => Promise<CreateClaimTokenResult>
  getClaimSession: (claimSessionId: string) => Promise<ClaimSession | null>
  /**
   * The active credential a bare bearer secret names, resolved by digest
   * against the unique `secret_hash` index, or null. The mirror of
   * `getSessionByToken`, for a client that presents only the secret.
   *
   * Completion-issued secrets do not expire, so this is a long-lived bearer:
   * pass `remote` from every HTTP route, or say `unattributed: true` and accept
   * that nothing is counted. A secret that names **no row at all** counts
   * against the lockout and a locked subject is refused, which is what makes a
   * credential-stuffing sweep across a fleet both bounded and visible in the
   * `security.lockout` audit trail (narduk-libs#228 review M2).
   *
   * A secret that names a **revoked or expired row** returns null and counts
   * nothing. That is not leniency, it is the difference between a guess and a
   * known-good credential gone stale: devices aboard one vessel share a public
   * IP, the edge presents its bearer on every ingest request, and a re-issue or
   * an operator rotation is exactly what makes one device's secret stale. Under
   * the old rule a single device retrying yesterday's secret refused its
   * healthy neighbours 99.7% of the time with no attacker present
   * (narduk-libs#228 second review H1). A successful resolution writes nothing
   * either — this is a per-request read path.
   */
  getCredentialBySecret: (
    secret: string,
    options: CredentialSecretLookupOptions,
  ) => Promise<DeviceCredential | null>
  getDevice: (deviceId: string) => Promise<Device | null>
  /** The active (unexpired, unrevoked) session named by its row id, or null. */
  getSession: (sessionId: string) => Promise<DeviceSession | null>
  /** The active session a bearer token names, resolved by digest, or null. */
  getSessionByToken: (sessionToken: string) => Promise<DeviceSession | null>
  heartbeat: (input: SessionSelector) => Promise<HeartbeatResult>
  issueApprovalToken: (input: IssueApprovalTokenInput) => Promise<IssueApprovalTokenResult>
  issueChallenge: (input: IssueChallengeInput) => Promise<IssueChallengeResult>
  listAuditEvents: (input?: ListAuditEventsInput) => Promise<DevicesAuditEvent[]>
  listDevices: (input: ListDevicesInput) => Promise<Device[]>
  openSession: (input: OpenSessionInput) => Promise<OpenSessionResult>
  /**
   * Delete expired replay entries and auth attempts no rule can still count.
   * `openSession` and `startClaim` call it opportunistically; a consumer may
   * also run it from a cron.
   */
  pruneExpired: (input?: { before?: number }) => Promise<PruneExpiredResult>
  revokeClaimToken: (input: ActorInput & { claimTokenId: string }) => Promise<ClaimToken>
  revokeDevice: (input: ActorInput & { deviceId: string }) => Promise<Device>
  revokeSession: (input: ActorInput & SessionSelector) => Promise<DeviceSession>
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
  const skewSeconds = options.timestampSkewSeconds ?? TIMESTAMP_SKEW_DEFAULT_SECONDS
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

  /**
   * Records an attempt and writes the security audit row for any escalating
   * threshold crossed. The gate reports flat (token/device) crossings too; the
   * library's own trail records only the escalating account/IP kind, as it
   * always has.
   */
  async function recordAttempt(
    subjects: readonly LockoutSubject[],
    outcome: 'success' | 'failure',
    context: { orgId: string | null; reason?: string },
  ): Promise<void> {
    const crossed = await lockouts.record(subjects, outcome)
    for (const threshold of crossed) {
      if (!threshold.escalates) continue
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

  /**
   * The account/IP subjects a caller's `remote` resolves to, **namespaced by
   * the operation counting them** (`lockoutSubjectFor`).
   *
   * `purpose` is required rather than defaulted: the whole failure mode HIGH-4
   * describes is one path silently writing into another's counter, and a
   * default is exactly how a new call site would inherit somebody else's
   * (narduk-libs#228 third review HIGH-4).
   */
  function remoteSubjects(
    remote: RemoteContext | undefined,
    purpose: LockoutPurpose,
  ): LockoutSubject[] {
    const subjects: LockoutSubject[] = []
    if (remote?.accountKey) {
      subjects.push({ kind: 'account', subject: lockoutSubjectFor(purpose, remote.accountKey) })
    }
    if (remote?.ip) subjects.push({ kind: 'ip', subject: lockoutSubjectFor(purpose, remote.ip) })
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

  async function findSessionByTokenHash(tokenHash: string): Promise<DeviceSession | undefined> {
    return first(
      await db
        .select()
        .from(devicesSessions)
        .where(eq(devicesSessions.tokenHash, tokenHash))
        .limit(1)
        .all(),
    )
  }

  /**
   * Resolve a `SessionSelector`. The bearer never reaches a query in the clear:
   * `sessionToken` is digested and matched against the unique `token_hash`.
   */
  async function selectSession(selector: SessionSelector): Promise<DeviceSession | undefined> {
    if (selector.sessionToken !== undefined) {
      return findSessionByTokenHash(await sha256Hex(selector.sessionToken))
    }
    return findSession(selector.sessionId)
  }

  function selectorLabel(selector: SessionSelector): string {
    // Never the bearer itself: a "not found" message must stay loggable.
    return selector.sessionToken === undefined ? selector.sessionId : 'the presented bearer token'
  }

  /**
   * Bounded, opportunistic prune. Both DELETEs are single statements with an
   * index-backed predicate rather than a LIMIT (D1's SQLite is built without
   * `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`), and the auth-attempt cutoff is older
   * than the widest lockout window, so nothing a live check reads is removed.
   */
  async function prune(before?: number): Promise<PruneExpiredResult> {
    const at = before ?? now()
    const replayEntries = await db
      .delete(devicesReplayEntries)
      .where(lte(devicesReplayEntries.expiresAt, at))
      .returning({ id: devicesReplayEntries.id })
      .all()
    const scopedNonces = await db
      .delete(devicesScopedNonces)
      .where(lte(devicesScopedNonces.expiresAt, at))
      .returning({ id: devicesScopedNonces.id })
      .all()
    const authAttempts = await db
      .delete(devicesAuthAttempts)
      .where(lt(devicesAuthAttempts.at, at - DEVICES_LOCKOUT_MAX_WINDOW_SECONDS * 1000))
      .returning({ id: devicesAuthAttempts.id })
      .all()
    return {
      replayEntries: replayEntries.length,
      scopedNonces: scopedNonces.length,
      authAttempts: authAttempts.length,
    }
  }

  /** Pruning is housekeeping: it must never turn into an authentication failure. */
  async function pruneOpportunistically(): Promise<void> {
    try {
      await prune()
    } catch {
      // Deliberately swallowed. `pruneExpired()` is the surface that reports.
    }
  }

  async function findChallenge(id: string): Promise<DeviceChallenge | undefined> {
    return first(
      await db.select().from(devicesChallenges).where(eq(devicesChallenges.id, id)).limit(1).all(),
    )
  }

  /**
   * What a `startClaim` that lost the redemption race should report: the state
   * of the session that won, or — when the token is spent with no session left
   * to point at — why it cannot be redeemed.
   */
  async function resolveLostRedemption(
    token: ClaimToken,
    hardwareFingerprint: string,
  ): Promise<
    | { expiresAt: number; kind: 'failure'; status: ClaimStartStatus }
    | { kind: 'session'; result: StartClaimResult }
  > {
    const winner = first(
      await db
        .select()
        .from(devicesClaimSessions)
        .where(eq(devicesClaimSessions.claimTokenId, token.id))
        .orderBy(desc(devicesClaimSessions.createdAt))
        .limit(1)
        .all(),
    )
    if (!winner) {
      const current = await findClaimToken(token.id)
      const expiresAt = current?.expiresAt ?? token.expiresAt
      const expired = current !== undefined && current.expiresAt <= now()
      return { kind: 'failure', status: expired ? 'expired' : 'revoked', expiresAt }
    }
    if (winner.hardwareFingerprint !== hardwareFingerprint) {
      return { kind: 'failure', status: 'hardware_mismatch', expiresAt: winner.expiresAt }
    }
    return {
      kind: 'session',
      result: {
        claimSessionId: winner.id,
        status: sessionStartStatus(winner),
        expiresAt: winner.expiresAt,
      },
    }
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

  /**
   * Path-specific authorization for a completion. Returned, never thrown: a
   * refusal is one of the wire statuses and counts against the lockout.
   */
  type ApprovalOutcome =
    { approvedByUserId: string; ok: true } | { ok: false; status: ClaimCompleteStatus }

  interface CompleteClaimRun {
    /** The account the lockout counts this attempt against, or null if none is known yet. */
    accountSubject: (session: ClaimSession) => string | null
    authorize: (
      session: ClaimSession,
      token: ClaimToken,
    ) => ApprovalOutcome | Promise<ApprovalOutcome>
    /**
     * May this caller be served a replay of the completion it already made?
     *
     * Exactly `authorize` minus its approval-expiry clause, and never less:
     * a replay rotates live credentials, so it must not be a cheaper route to
     * a credential set than the completion itself. The one relaxation is
     * deliberate — approvals live five minutes, the recovery window is the
     * claim session's fifteen — and every other clause `authorize` applies,
     * including whatever secret or signature proves the caller, applies here
     * too (narduk-libs#228 review L2).
     */
    canReissue: (session: ClaimSession, token: ClaimToken) => boolean | Promise<boolean>
    /**
     * Did this call present a secret only the genuine device could hold — the
     * raw approval token, or a signed `deviceProof`?
     *
     * `authorize` alone does not answer that on
     * `completeClaimWithRecordedApproval`: it verifies a proof only `if (proof
     * !== undefined)`, so a first completion with **no** proof passes on the
     * recorded approval plus four values that all travel on the wire. That
     * caller is authorized to complete, but it has proved nothing, and it is
     * the only reason `alreadyCompleted(…, true)` could disclose `deviceId` to
     * a caller the JSDoc there says proved something (narduk-libs#228 third
     * review LOW-4).
     */
    carriesProof: boolean
    claimSessionId: string
    /**
     * The single-use row the re-issue batch must burn atomically with the serve,
     * or null on a path that authenticates with a bearer and carries no proof.
     * Read after `canReissue` has already verified the signature, so it only
     * ever names a nonce this caller is entitled to spend.
     */
    completionProofNonce: (session: ClaimSession) => ScopedNonceRef | null
    hardwareFingerprint: string
    idempotencyKey: string
    installationId: string
    reissue: boolean
    remote: RemoteContext | undefined
  }

  /**
   * Claim a single-use `(scope, nonce)`. `true` is a first presentation,
   * `false` a replay. One insert, decided by the UNIQUE index.
   */
  async function consumeScopedNonce(
    scope: string,
    nonce: string,
    expiresAt: number,
  ): Promise<boolean> {
    const inserted = await db
      .insert(devicesScopedNonces)
      .values({ id: nextId(), scope, nonce, expiresAt, createdAt: now() })
      .onConflictDoNothing()
      .returning({ id: devicesScopedNonces.id })
      .all()
    return inserted.length > 0
  }

  /**
   * Does this proof show the caller holds the private key the claim session
   * recorded, for this exact request?
   *
   * The first two legs `openSession` verifies, in the same order: bind every
   * signed field to resolved state, then verify the Ed25519 signature against
   * the *recorded* key. Single use is the caller's third leg, because where the
   * nonce is burned differs by path:
   *
   * - a **first completion** burns it here, before the completion batch, so a
   *   captured first-completion proof cannot later be turned into a re-issue;
   * - a **re-issue** burns it *inside* the re-issue batch, so a caller that
   *   loses the single-writer race spends nothing and its own retry of the
   *   identical payload is admitted (narduk-libs#228 second review H2).
   *
   * Either way this function is evaluated last on every path, so a caller
   * refused by a cheaper check never reaches the nonce at all.
   */
  async function completionProofBinds(
    session: ClaimSession,
    bound: {
      devicePublicKey: string
      hardwareFingerprint: string
      idempotencyKey: string
      installationId: string
    },
    proof: DeviceCompletionProof,
  ): Promise<boolean> {
    const request = proof.canonicalRequest
    if (
      request.claimSessionId !== session.id ||
      request.devicePublicKey !== session.publicKey ||
      request.devicePublicKey !== bound.devicePublicKey ||
      request.hardwareFingerprint !== bound.hardwareFingerprint ||
      request.idempotencyKey !== bound.idempotencyKey ||
      request.installationId !== bound.installationId ||
      request.nonce.trim().length === 0
    ) {
      return false
    }
    if (!isWithinTimestampSkew(request.timestamp, now(), skewSeconds)) return false
    // Decoded without throwing: a malformed proof is an authentication
    // failure the caller's lockout counts, never an uncaught DOMException.
    const signatureBytes = tryBase64UrlDecode(proof.signature)
    const publicKeyBytes = tryBase64UrlDecode(session.publicKey)
    if (!signatureBytes || publicKeyBytes?.length !== ED25519_PUBLIC_KEY_BYTES) return false
    const verified = await verifySignature({
      message: canonicalBytes(request as unknown as CanonicalValue),
      publicKey: publicKeyBytes,
      signature: signatureBytes,
    })
    return verified
  }

  /** The single-use row a completion proof's nonce occupies for this session. */
  function completionProofNonceRef(
    session: ClaimSession,
    proof: DeviceCompletionProof,
  ): ScopedNonceRef {
    return {
      scope: completionNonceScope(session.id),
      nonce: proof.canonicalRequest.nonce,
      expiresAt: session.expiresAt,
    }
  }

  /**
   * Has this claim session already been replayed `MAX_REISSUES_PER_CLAIM_SESSION`
   * times? Counted from the audit rows the re-issue itself writes — a device row
   * is created by exactly one claim session, so its `claim.reissue` events are
   * that session's — and the read is bounded by the cap rather than by history.
   *
   * Two concurrent replays can both pass this check and one will still lose the
   * compare-and-swap, so the cap bounds churn; it is not, and cannot be, the
   * control that makes an unauthenticated re-issue safe.
   */
  async function reissueCapReached(deviceId: string): Promise<boolean> {
    const served = await db
      .select({ id: devicesAuditEvents.id })
      .from(devicesAuditEvents)
      .where(
        and(
          eq(devicesAuditEvents.action, 'claim.reissue'),
          eq(devicesAuditEvents.subjectKind, 'device'),
          eq(devicesAuditEvents.subjectId, deviceId),
        ),
      )
      .limit(MAX_REISSUES_PER_CLAIM_SESSION)
      .all()
    return served.length >= MAX_REISSUES_PER_CLAIM_SESSION
  }

  /**
   * Why a replay was not served with a fresh set. `contended` is deliberately
   * separate from `not_serviceable`: the caller lost the compare-and-swap to a
   * concurrent replay of its own request, and its credentials were rotated by
   * the winner, so the honest answer is "retry", not a terminal status
   * (narduk-libs#228 review H3).
   */
  type ReplayOutcome =
    | { kind: 'capped' }
    | { kind: 'contended' }
    | { kind: 'not_serviceable' }
    | { kind: 'proof_spent' }
    | { kind: 'served'; result: CompleteClaimResult }

  /**
   * Serve a replayed completion with a fresh equivalent credential set.
   *
   * Only the digests of the original secrets were ever stored, so the first
   * result cannot be re-served verbatim without keeping a live bearer in the
   * database in the clear. Instead every active credential is rotated to its
   * next version inside one transaction and the new set is returned, so the
   * device recovers and the superseded secrets die together.
   */
  async function reissueForReplay(
    session: ClaimSession,
    idempotencyKey: string,
    proofNonce: ScopedNonceRef | null,
  ): Promise<ReplayOutcome> {
    if (session.completionIdempotencyKey !== idempotencyKey) return { kind: 'not_serviceable' }
    if (session.deviceId === null) return { kind: 'not_serviceable' }
    // Recovery is bounded by the claim session, never open-ended.
    if (session.expiresAt <= now()) return { kind: 'not_serviceable' }
    const device = await findDevice(session.deviceId)
    if (!device || device.status !== 'claimed') return { kind: 'not_serviceable' }
    if (await reissueCapReached(device.id)) return { kind: 'capped' }

    const active = await db
      .select()
      .from(devicesCredentials)
      .where(and(eq(devicesCredentials.deviceId, device.id), isNull(devicesCredentials.revokedAt)))
      .all()
    if (active.length === 0) return { kind: 'not_serviceable' }
    const ordered = [...active].sort(
      (a, b) =>
        CREDENTIAL_CLASSES.indexOf(a.credentialClass) -
        CREDENTIAL_CLASSES.indexOf(b.credentialClass),
    )
    const prepared = await Promise.all(
      ordered.map((credential) =>
        prepareCredential(credential.credentialClass, credential.version + 1, credential.expiresAt),
      ),
    )
    const reissuedAt = now()
    const outcome: ReissueOutcome = await reissueCredentialsAtomically(
      db,
      {
        device,
        claimSessionId: session.id,
        idempotencyKey,
        credentials: prepared.map((entry) => entry.prepared),
        lockExpiresAt: session.expiresAt,
        proofNonce,
        reissuedAt,
      },
      nextId,
    )
    if (outcome !== 'served') return { kind: outcome }
    // Fresh secrets, returned exactly once; only their digests were stored.
    return {
      kind: 'served',
      result: {
        status: 'completed',
        deviceId: device.id,
        credentials: prepared.map((entry) => entry.issued),
      },
    }
  }

  /**
   * The state-machine refusal a completion attempt hits before authorization is
   * even considered, or null to proceed. An unmarked session that has run out of
   * time is marked expired on the way through.
   */
  async function completionBlocker(
    session: ClaimSession,
    token: ClaimToken,
    hardwareFingerprint: string,
  ): Promise<ClaimCompleteStatus | null> {
    if (session.status === 'revoked' || token.revokedAt !== null) return 'revoked'
    // Single use: the token was consumed when this session redeemed it, so a
    // consumption naming any other session means the token is already spent
    // (narduk-libs#212 review finding 3).
    if (token.consumedAt !== null && token.consumedByClaimSessionId !== session.id) return 'revoked'
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
      return 'expired'
    }
    if (session.hardwareFingerprint !== hardwareFingerprint) return 'hardware_mismatch'
    return null
  }

  /**
   * Everything both completion paths share: state machine, lockouts, replay
   * handling and the atomic write. The two differ only in who they count the
   * attempt against and how they prove the completion was authorized.
   */
  /**
   * The `status = 'claimed'` branch of a completion: someone is replaying a
   * claim that already finished.
   *
   * Its own function because every clause here is a security decision and they
   * read better together than folded into the completion path. 0.1.0 answered
   * this branch with one unconditional `already_completed`; everything below is
   * what it costs to answer it with live credentials instead.
   */
  async function replayCompletion(
    session: ClaimSession,
    token: ClaimToken,
    ctx: {
      alreadyCompleted: (completed: ClaimSession, discloseDeviceId: boolean) => CompleteClaimResult
      fail: (status: ClaimCompleteStatus, reason?: string) => Promise<CompleteClaimResult>
      idempotencyKey: string
      recordSuccess: () => Promise<void>
      run: CompleteClaimRun
    },
  ): Promise<CompleteClaimResult> {
    // Not opted in: exactly 0.1.0's answer, nothing is rotated — and nothing is
    // disclosed either. This is the branch an unauthenticated caller reaches by
    // default, so it must not hand back the `deviceId` that names the library's
    // own re-issue lock scope (narduk-libs#228 second review H3).
    if (!ctx.run.reissue) return ctx.alreadyCompleted(session, false)
    // An operator who revokes the claim token after completion expects the
    // claim to be dead, re-issues included (narduk-libs#228 review L1).
    if (token.revokedAt !== null) return ctx.fail('revoked')
    if (!(await ctx.run.canReissue(session, token))) {
      // A refused replay is a failed authentication attempt: it counts against
      // the lockout and leaves an attempt row, exactly like every other refusal
      // here, instead of being unlimited and untraced (review H2). No
      // `deviceId` either — a caller that proved nothing learns nothing.
      return ctx.fail('already_completed', 'reissue_refused')
    }
    // Past `canReissue` the caller is authenticated: it either signed this
    // exact request with the key the claim session recorded, or presented the
    // raw approval token. Every outcome below is therefore a *served or not
    // serviceable* answer to a genuine device — never a guess — so none of them
    // advances a lockout counter (narduk-libs#228 second review H2, M4).
    const proofNonce = ctx.run.completionProofNonce(session)
    const outcome = await reissueForReplay(session, ctx.idempotencyKey, proofNonce)
    if (outcome.kind === 'served') {
      await ctx.recordSuccess()
      return outcome.result
    }
    if (outcome.kind === 'contended') {
      // The winner rotated this device's credentials, so a terminal status here
      // would brick it. Retry is the recovery (review H3) — and because the
      // proof's nonce is burned inside the winning batch, this caller spent
      // nothing and may resend the identical signed payload.
      return {
        status: 'rate_limited',
        credentials: [],
        retryAfterSeconds: reissueRetryAfterSeconds(),
        ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
      }
    }
    // `proof_spent`: this exact signed request was already served. `capped`:
    // the claim session has had its `MAX_REISSUES_PER_CLAIM_SESSION` re-issues.
    // `not_serviceable`: nothing left to rotate. All three are terminal for
    // *this* request; a fresh proof is what recovers, inside the cap.
    //
    // None of them discloses `deviceId`. A replay is the one branch a wire
    // capture can reach — an Ed25519 signature over a fixed message is
    // replayable by anyone who saw it, and `proof_spent` is precisely the
    // signal that says this payload has been seen before — so the replay path
    // tells a caller its outcome and nothing else.
    return ctx.alreadyCompleted(session, false)
  }

  async function runCompleteClaim(run: CompleteClaimRun): Promise<CompleteClaimResult> {
    const installationId = requireText(run.installationId, 'installationId')
    const idempotencyKey = requireText(run.idempotencyKey, 'idempotencyKey')
    const session = await findClaimSession(run.claimSessionId)
    if (!session) {
      // Naming a session id that does not exist is a failed authentication
      // attempt, not a free oracle: it is counted against whatever remote
      // subject the caller presented, and a locked subject gets the same
      // `rate_limited` answer every other refusal here gets
      // (narduk-libs#228 second review L1). The `not_found` throw itself is
      // unchanged — it is the documented contract for an unknown id.
      const remote = remoteSubjects(run.remote, 'claim')
      const enumerating = await lockouts.check(remote)
      if (enumerating) {
        return {
          status: 'rate_limited',
          credentials: [],
          retryAfterSeconds: enumerating.retryAfterSeconds,
        }
      }
      await recordAttempt(remote, 'failure', { orgId: null, reason: 'claim session not found' })
      throw new DevicesError('not_found', `Claim session ${run.claimSessionId} does not exist.`)
    }
    const token = await findClaimToken(session.claimTokenId)
    if (!token) throw new DevicesError('not_found', 'The claim token behind this session is gone.')

    const account = run.accountSubject(session)
    const subjects: LockoutSubject[] = [
      { kind: 'token', subject: token.tokenHash },
      // Namespaced exactly like a `remote` account key: the approving account
      // is the same kind of subject, so it must not share a counter with the
      // credential lookup either (narduk-libs#228 third review HIGH-4).
      ...(account === null
        ? []
        : [{ kind: 'account' as const, subject: lockoutSubjectFor('claim', account) }]),
      ...remoteSubjects(run.remote, 'claim').filter(
        (subject) => account === null || subject.kind !== 'account',
      ),
    ]
    const locked = await lockouts.check(subjects)
    if (locked) {
      return {
        status: 'rate_limited',
        credentials: [],
        retryAfterSeconds: locked.retryAfterSeconds,
      }
    }

    const fail = async (
      status: ClaimCompleteStatus,
      reason: string = status,
    ): Promise<CompleteClaimResult> => {
      await recordAttempt(subjects, 'failure', { orgId: token.orgId, reason })
      return { status, credentials: [] }
    }
    /**
     * `discloseDeviceId` is true on exactly one path: a caller that ran the
     * full authorization for a *first* completion, **presented a secret only
     * the device could hold**, and merely lost the race to another equally
     * authorized attempt — a caller that would have been handed `deviceId` had
     * it won.
     *
     * Both halves are needed. Every replay answer passes false, because
     * `deviceId` names the scope of the library's own re-issue lock and handing
     * it to a caller that proved nothing is what let an attacker aim
     * pre-inserted rows at the recovery path (narduk-libs#228 second review
     * H3). And the race-loser branch passes `run.carriesProof` rather than a
     * bare `true`, because on `completeClaimWithRecordedApproval` a first
     * completion without `deviceProof` is authorized on the recorded approval
     * plus four on-wire values alone — authorized, but proof-less, so the
     * rationale above did not hold for it (third review LOW-4).
     */
    const alreadyCompleted = (
      completed: ClaimSession,
      discloseDeviceId: boolean,
    ): CompleteClaimResult => ({
      status: 'already_completed',
      credentials: [],
      ...(discloseDeviceId && completed.deviceId !== null ? { deviceId: completed.deviceId } : {}),
    })

    if (session.status === 'claimed') {
      return replayCompletion(session, token, {
        alreadyCompleted,
        fail,
        idempotencyKey,
        recordSuccess: async () => recordAttempt(subjects, 'success', { orgId: token.orgId }),
        run,
      })
    }
    const blocker = await completionBlocker(session, token, run.hardwareFingerprint)
    if (blocker !== null) return fail(blocker)

    const approval = await run.authorize(session, token)
    if (!approval.ok) return fail(approval.status)

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
        approvedByUserId: approval.approvedByUserId,
        idempotencyKey,
        completedAt,
        credentials: [ingest.prepared, command.prepared],
      },
      nextId,
    )
    if (!won) {
      const current = await findClaimSession(session.id)
      // Authorized: this caller passed `run.authorize` and merely lost the
      // completion race to a concurrent, equally authorized attempt. It learns
      // `deviceId` only if it also proved possession — a raw approval token or
      // a signed `deviceProof` (third review LOW-4).
      if (current?.status === 'claimed') return alreadyCompleted(current, run.carriesProof)
      if (current?.status === 'revoked') return fail('revoked')
      return fail('expired')
    }
    await recordAttempt(subjects, 'success', { orgId: token.orgId })
    // Secrets are returned exactly once; only their digests were stored.
    return { status: 'completed', deviceId, credentials: [ingest.issued, command.issued] }
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
        consumedByClaimSessionId: null,
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

      await pruneOpportunistically()
      // The per-token window is keyed on the *presented* token's digest, so it
      // bounds guessing even when the caller passes no `remote`. Every H3 route
      // must still pass `remote` — that is what bounds enumeration across
      // different tokens (README §Lockouts, narduk-libs#212 review finding 5).
      const tokenHash = await sha256Hex(claimToken)
      const subjects: LockoutSubject[] = [
        { kind: 'token', subject: tokenHash },
        ...remoteSubjects(input.remote, 'claim'),
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

      // Checked after the gate and counted as a failure: a malformed key
      // presented with a guessed token must not be a free attempt.
      const publicKeyBytes = tryBase64UrlDecode(devicePublicKey)
      if (!publicKeyBytes || publicKeyBytes.length !== ED25519_PUBLIC_KEY_BYTES) {
        await recordAttempt(subjects, 'failure', { orgId: null, reason: 'malformed_public_key' })
        throw new DevicesError('invalid', 'devicePublicKey must be a raw base64url Ed25519 key.')
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

      // Redemption is one transaction: the session is inserted from the token
      // row only while that row is still unconsumed, and the same transaction
      // stamps the consumption. Two concurrent starts cannot both create a
      // session on one token (narduk-libs#212 review finding 3).
      const createdAt = now()
      const claimSessionId = nextId()
      const won = await startClaimAtomically(
        db,
        {
          claimSessionId,
          idempotencyKey,
          hardwareFingerprint,
          fingerprintAlgorithm,
          publicKey: devicePublicKey,
          softwareVersion,
          createdAt,
          token,
        },
        nextId,
      )
      if (!won) {
        // Lost the race (or the token was spent in between): report the state
        // the winning session is in rather than inventing a second one.
        const lost = await resolveLostRedemption(token, hardwareFingerprint)
        return lost.kind === 'session' ? lost.result : fail(lost.status, lost.expiresAt)
      }
      await recordAttempt(subjects, 'success', { orgId: token.orgId })
      return {
        claimSessionId,
        status: 'pending_user_approval',
        expiresAt: token.expiresAt,
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
      // Authorise before describing: whether this caller may hear anything
      // about the session is settled before its state is reported. Checked
      // after the state, a foreign org's admin holding a session id (it
      // travels to the appliance and the org console renders it) learned
      // `conflict` / `revoked` / `expired` for a session that is not theirs —
      // claim state leaking across the tenant boundary (narduk-libs#243).
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
      if (session.status === 'claimed') {
        throw new DevicesError('conflict', `Claim session ${session.id} is already completed.`)
      }
      if (session.status === 'revoked') {
        throw new DevicesError('revoked', `Claim session ${session.id} was revoked.`)
      }
      if (session.status === 'expired' || session.expiresAt <= now()) {
        throw new DevicesError('expired', `Claim session ${session.id} expired.`)
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
      const orgAndResourceMatch = (token: ClaimToken): boolean =>
        token.orgId === input.orgId &&
        sameResource({ kind: token.resourceKind, id: token.resourceId }, input.resource)
      const approvalMatchesActor = (session: ClaimSession): boolean =>
        session.approvalUserId === approvedByUserId &&
        session.approvalOrgId === input.orgId &&
        session.approvalResourceKind === input.resource.kind &&
        session.approvalResourceId === input.resource.id
      const presentedApprovalMatches = async (session: ClaimSession): Promise<boolean> =>
        session.approvalTokenHash !== null &&
        timingSafeEqualHex(await sha256Hex(input.userApprovalToken), session.approvalTokenHash)

      return runCompleteClaim({
        claimSessionId: input.claimSessionId,
        hardwareFingerprint: input.hardwareFingerprint,
        idempotencyKey: input.idempotencyKey,
        installationId: input.installationId,
        reissue: input.reissueOnIdempotentReplay ?? false,
        remote: input.remote,
        accountSubject: () => approvedByUserId,
        // The raw approval token *is* this path's proof of possession — it is a
        // secret the caller had to hold, and `authorize` compares it on every
        // completion — so a race loser here has proved something (third review
        // LOW-4). It is not a single-use signed proof, so there is no nonce for
        // the batch to burn.
        carriesProof: true,
        completionProofNonce: () => null,
        canReissue: async (session, token) =>
          session.hardwareFingerprint === input.hardwareFingerprint &&
          orgAndResourceMatch(token) &&
          (await presentedApprovalMatches(session)) &&
          approvalMatchesActor(session),
        authorize: async (session, token) => {
          if (!orgAndResourceMatch(token)) return { ok: false, status: 'unauthorized_user' }
          if (
            session.approvalExpiresAt === null ||
            session.approvalExpiresAt <= now() ||
            !(await presentedApprovalMatches(session))
          ) {
            return { ok: false, status: 'approval_required' }
          }
          if (!approvalMatchesActor(session)) return { ok: false, status: 'unauthorized_user' }
          return { ok: true, approvedByUserId }
        },
      })
    },

    async completeClaimWithRecordedApproval(input) {
      const devicePublicKey = requireText(input.devicePublicKey, 'devicePublicKey')
      const reissue = input.reissueOnIdempotentReplay ?? false
      const proof = input.deviceProof
      if (reissue && proof === undefined) {
        // Refused loudly rather than served: a re-issue revokes the genuine
        // device's credentials and sessions and hands the caller live secrets,
        // and every value below travels on the wire, so without a proof the
        // capability is device takeover by whoever saw the handoff
        // (narduk-libs#228 review H1).
        throw new DevicesError(
          'invalid',
          'reissueOnIdempotentReplay requires deviceProof: re-issuing rotates the device\u2019s live credentials, so the caller must prove it holds the claim session key.',
        )
      }
      // The key is public material, so a plain comparison leaks nothing: this
      // binds the caller to the device that started the claim. It is a binding
      // check, never an authentication — `proves` is what authenticates.
      const bindsDevice = (session: ClaimSession): boolean =>
        session.publicKey === devicePublicKey &&
        session.hardwareFingerprint === input.hardwareFingerprint
      const approvalMatchesToken = (session: ClaimSession, token: ClaimToken): boolean =>
        session.approvalUserId !== null &&
        session.approvalOrgId === token.orgId &&
        session.approvalResourceKind === token.resourceKind &&
        session.approvalResourceId === token.resourceId
      const boundFields = {
        devicePublicKey,
        hardwareFingerprint: input.hardwareFingerprint,
        idempotencyKey: input.idempotencyKey,
        installationId: input.installationId,
      }
      // Evaluated last on every path, so a caller refused by a cheaper check
      // never reaches the nonce it presented.
      const binds = async (session: ClaimSession): Promise<boolean> =>
        proof !== undefined && (await completionProofBinds(session, boundFields, proof))
      /**
       * A **first** completion spends the proof here, outside the completion
       * batch. That burn is load-bearing: without it a captured
       * first-completion proof still satisfies every re-issue binding — same
       * session, same key, same idempotency key — and would buy a fresh
       * credential set (narduk-libs#228 review H1). The re-issue path burns in
       * its own batch instead; see `completionProofNonce` below.
       */
      const proves = async (session: ClaimSession): Promise<boolean> => {
        if (proof === undefined) return false
        if (!(await binds(session))) return false
        const ref = completionProofNonceRef(session, proof)
        return consumeScopedNonce(ref.scope, ref.nonce, ref.expiresAt)
      }

      return runCompleteClaim({
        claimSessionId: input.claimSessionId,
        hardwareFingerprint: input.hardwareFingerprint,
        idempotencyKey: input.idempotencyKey,
        installationId: input.installationId,
        reissue,
        remote: input.remote,
        accountSubject: (session) => session.approvalUserId,
        // Without `deviceProof` this path authenticates on the recorded
        // approval and four values that travel on the wire, so a first
        // completion can be authorized having proved nothing. Such a caller
        // does not learn `deviceId` when it loses the race (third review
        // LOW-4).
        carriesProof: proof !== undefined,
        completionProofNonce: (session) =>
          proof === undefined ? null : completionProofNonceRef(session, proof),
        canReissue: async (session, token) =>
          bindsDevice(session) &&
          session.approvalTokenHash !== null &&
          approvalMatchesToken(session, token) &&
          (await binds(session)),
        authorize: async (session, token) => {
          if (!bindsDevice(session)) return { ok: false, status: 'hardware_mismatch' }
          if (
            session.approvalTokenHash === null ||
            session.approvalUserId === null ||
            session.approvalExpiresAt === null ||
            session.approvalExpiresAt <= now()
          ) {
            return { ok: false, status: 'approval_required' }
          }
          if (!approvalMatchesToken(session, token)) {
            return { ok: false, status: 'unauthorized_user' }
          }
          if (proof !== undefined && !(await proves(session))) {
            return { ok: false, status: 'unauthorized_user' }
          }
          // No raw approval token crosses this boundary: the recorded approval
          // on the row is the authorization.
          return { ok: true, approvedByUserId: session.approvalUserId }
        },
      })
    },

    async consumeNonce(input) {
      const scope = requireText(input.scope, 'scope')
      const nonce = requireText(input.nonce, 'nonce')
      const expiresAt = requirePositiveInteger(input.expiresAt, 'expiresAt')
      // The package writes its own single-use rows into this table — the
      // completion-proof nonce and the re-issue single-writer lock — so the
      // prefix that names them is reserved. Without this, a consumer that
      // forwards an attacker-influenced scope lets the attacker pre-insert the
      // lock rows the recovery path needs and wedge it permanently
      // (narduk-libs#228 second review H3).
      if (scope.startsWith(DEVICES_INTERNAL_NONCE_PREFIX)) {
        throw new DevicesError(
          'invalid',
          `scope must not start with "${DEVICES_INTERNAL_NONCE_PREFIX}": that prefix is reserved for this package's own single-use rows.`,
        )
      }
      // A caller-chosen expiry `pruneExpired` can never reach is a permanent
      // row in a table the package depends on (second review L3). Refused
      // rather than clamped: clamping would silently shorten the caller's own
      // replay window instead of telling it.
      if (expiresAt > now() + SCOPED_NONCE_MAX_TTL_SECONDS * 1000) {
        throw new DevicesError(
          'invalid',
          `expiresAt must be no more than ${String(SCOPED_NONCE_MAX_TTL_SECONDS)} seconds ahead: a nonce pruneExpired cannot reclaim is a permanent row.`,
        )
      }
      // Same shape as the session replay check: an insert that lands is a first
      // presentation, one that conflicts on (scope, nonce) is a replay. A row
      // past its expiry still refuses until `pruneExpired` removes it, which is
      // the safe direction. `deviceProof` burns its nonce through the same
      // primitive, under a reserved `narduk-devices:`-prefixed scope.
      return consumeScopedNonce(scope, nonce, expiresAt)
    },

    async getCredentialBySecret(secret, options) {
      // A completion-issued secret never expires and names no device to the
      // caller, so a stuffing sweep across a fleet used to leave no trace at
      // all. Failures are counted against the presented account/IP and a
      // locked subject is refused; a success writes nothing, because this is a
      // per-request read path (narduk-libs#228 review M2).
      //
      // The subjects are namespaced `credential:` so that nothing else — least
      // of all the claim ceremony's unauthenticated unknown-session counter —
      // can lock the vessel's ingest lookup (third review HIGH-4).
      //
      // The ternary is the runtime backstop for the type: `unattributed: true`
      // means *count nothing*, and a JavaScript caller that also passes a
      // `remote` the union forbids must still count nothing rather than have
      // its explicit opt-out silently overridden.
      const subjects =
        options.unattributed === true ? [] : remoteSubjects(options.remote, 'credential')
      // `AttributableRemoteContext` is satisfied by `{ ip: '' }` — `''` is a
      // `string` — and `remoteSubjects` gates on truthiness, so a consumer
      // writing `ip: getRequestIP(event) ?? ''` to satisfy the type compiles
      // straight into the blind lookup that type exists to forbid, and nothing
      // at runtime said so. A caller that asked to attribute and supplied
      // nothing to attribute to is a bug, not an unattributed lookup
      // (narduk-libs#228 third review MEDIUM-5).
      if (options.unattributed !== true && subjects.length === 0) {
        throw new DevicesError(
          'invalid',
          'getCredentialBySecret: `remote` resolved to no lockout subject. Pass a non-empty `accountKey` or `ip`, or ask for `{ unattributed: true }` on purpose.',
        )
      }
      if (await lockouts.check(subjects)) return null
      /**
       * A *guess*: the presented secret matches no row in the table. Only this
       * shape advances the counter, because only this shape is what a
       * credential-stuffing sweep produces.
       */
      const guessed = async (): Promise<null> => {
        await recordAttempt(subjects, 'failure', { orgId: null, reason: 'credential secret' })
        return null
      }
      if (secret.length === 0) return guessed()
      const secretHash = await sha256Hex(secret)
      const credential = first(
        await db
          .select()
          .from(devicesCredentials)
          .where(eq(devicesCredentials.secretHash, secretHash))
          .limit(1)
          .all(),
      )
      // What protects this lookup is a 256-bit secret and an equality seek on
      // its SHA-256 digest against a UNIQUE index: at most one row can match,
      // and it matched exactly. Re-comparing a digest the index already
      // equated cannot return false, so the constant-time call that used to
      // sit here documented a guard that was not the one doing the work
      // (narduk-libs#228 review M1). `verifyCredentialSecret` is where
      // `timingSafeEqualHex` is load-bearing: there the row is fetched by id.
      if (!credential) return guessed()
      // Stale, not a guess. The caller has already proved it held this exact
      // secret; a revoked or expired row is a known-good credential the fleet
      // rotated out from under it. Counting that against the vessel's shared IP
      // takes every camera aboard offline for a rotation nobody attacked
      // (narduk-libs#228 second review H1). Refuse the credential, count
      // nothing, and leave the neighbours served.
      if (credential.revokedAt !== null) return null
      if (credential.expiresAt !== null && credential.expiresAt <= now()) return null
      return credential
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
      await pruneOpportunistically()
      const subjects: LockoutSubject[] = [
        { kind: 'device', subject: input.deviceId },
        ...remoteSubjects(input.remote, 'session'),
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
      if (!requestBindsTo(request, device, credential)) {
        return fail('unauthorized', 'request binding mismatch')
      }
      // The exported helper, not a second copy of the rule: a consumer
      // bounding its own pre-device exchange with `assertTimestampSkew`
      // gets the window this path enforces (narduk-libs#228 review M4).
      if (!isWithinTimestampSkew(request.timestamp, now(), skewSeconds)) {
        return fail('unauthorized', 'timestamp outside skew window')
      }
      const challenge = await findChallenge(request.challengeId)
      if (!challenge || challenge.deviceId !== device.id || challenge.expiresAt <= now()) {
        return fail('unauthorized', 'challenge not active')
      }
      // Decoded without throwing: a malformed signature or stored key is an
      // authentication failure that counts against the device, never an
      // uncaught DOMException (narduk-libs#212 review finding 4).
      const signatureBytes = tryBase64UrlDecode(input.signature)
      const publicKeyBytes = tryBase64UrlDecode(device.publicKey)
      if (!signatureBytes || !publicKeyBytes) {
        return fail('unauthorized', 'malformed signature')
      }
      const verified = await verifySignature({
        message: canonicalBytes(request as unknown as CanonicalValue),
        publicKey: publicKeyBytes,
        signature: signatureBytes,
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
      // The bearer is a fresh random token, not the row id: the id is what the
      // audit trail names, and a trail that carried the bearer would hand out
      // live sessions (narduk-libs#212 review finding 2).
      const sessionToken = nextToken()
      const session: DeviceSession = {
        id: nextId(),
        tokenHash: await sha256Hex(sessionToken),
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
      // The raw session token is returned exactly once; only its digest is stored.
      return {
        sessionId: session.id,
        sessionToken,
        expiresAt: session.expiresAt,
        revocationGeneration: session.revocationGeneration,
      }
    },

    async pruneExpired(input = {}) {
      return prune(input.before)
    },

    async getSession(sessionId) {
      const session = await findSession(sessionId)
      if (!session || session.revokedAt !== null || session.expiresAt <= now()) return null
      return session
    },

    async getSessionByToken(sessionToken) {
      const session = await findSessionByTokenHash(await sha256Hex(sessionToken))
      if (!session || session.revokedAt !== null || session.expiresAt <= now()) return null
      return session
    },

    async heartbeat(input) {
      const session = await selectSession(input)
      if (!session)
        throw new DevicesError('not_found', `Session ${selectorLabel(input)} does not exist.`)
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
      const session = await selectSession(input)
      if (!session)
        throw new DevicesError('not_found', `Session ${selectorLabel(input)} does not exist.`)
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
      // Device, credentials, sessions and audit row in one transaction: a
      // failure part-way can no longer leave a revoked device whose
      // credentials still resolve (narduk-libs#231).
      const revoked = await revokeDeviceAtomically(
        db,
        {
          device,
          actorUserId: input.actorUserId ?? null,
          reason: input.reason ?? null,
          revokedAt: now(),
        },
        nextId,
      )
      // Null: a concurrent revocation committed first and wrote everything
      // this one would have. Report the device as it left it.
      return revoked ?? requireDevice(device.id)
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
      const { issued, prepared } = await prepareCredential(
        input.credentialClass,
        version,
        expiresAt,
      )
      // Supersede, issue, bump and audit in one transaction, the replacement
      // gated on the device still being claimed (narduk-libs#231).
      const rotated = await rotateCredentialAtomically(
        db,
        {
          device,
          credential: prepared,
          actorUserId: input.actorUserId ?? null,
          reason: input.reason ?? null,
          rotatedAt,
        },
        nextId,
      )
      // Revoked between the read above and the batch: nothing was issued.
      if (!rotated) throw new DevicesError('revoked', `Device ${device.id} is revoked.`)
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
      const secretHash = await sha256Hex(input.secret)
      return timingSafeEqualHex(secretHash, credential.secretHash) ? credential : null
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
