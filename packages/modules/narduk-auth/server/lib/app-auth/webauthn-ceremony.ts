import { createError } from 'h3'

import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  PASSKEYS_UNAVAILABLE_MESSAGE,
  type RegistrationResponseJSON,
  type WebauthnServer,
} from './webauthn-server'
import {
  evaluateSignatureCounter,
  isClaimedChallengeUsable,
  normalizePasskeyName,
  readPresentedChallenge,
} from './webauthn-verification'

import type { ResolvedWebauthnConfig } from '../../../shared/utils/webauthn-config'

/** The ceremonies with storage, session and logging injected; no Nuxt-layer import. */

export type WebauthnChallengePurpose = 'authentication' | 'registration'

export interface PasskeyCredentialRecord {
  backedUp: boolean
  counter: number
  createdAt: string
  deviceType: 'multiDevice' | 'singleDevice'
  id: string
  lastUsedAt: string | null
  name: string | null
  publicKey: string
  rpId: string
  transports: AuthenticatorTransportFuture[]
  userId: string
}

export interface StoredWebauthnChallenge {
  expiresAt: number
  purpose: WebauthnChallengePurpose
  userId: string | null
}

export interface PasskeyStore {
  /** Compare-and-set on `expectedCounter`; false when another assertion won. */
  advanceCredential(
    credentialId: string,
    expectedCounter: number,
    next: Pick<PasskeyCredentialRecord, 'backedUp' | 'counter' | 'deviceType' | 'lastUsedAt'>,
  ): Promise<boolean>
  /** Deletes by hash before returning, so any presentation burns the row. */
  consumeChallenge(challengeHash: string): Promise<StoredWebauthnChallenge | null>
  /** Scoped to `userId`; false when no such credential belongs to them. */
  deleteCredential(userId: string, credentialId: string): Promise<boolean>
  findCredential(credentialId: string): Promise<PasskeyCredentialRecord | null>
  /** False when the credential id already exists; never an upsert. */
  insertCredential(record: PasskeyCredentialRecord): Promise<boolean>
  /** False when the live-challenge ceiling is reached. */
  issueChallenge(challengeHash: string, challenge: StoredWebauthnChallenge): Promise<boolean>
  listCredentials(userId: string): Promise<PasskeyCredentialRecord[]>
}

export interface PasskeyCeremonyLog {
  error(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
}

export interface PasskeyCeremonyContext {
  config: ResolvedWebauthnConfig
  log?: PasskeyCeremonyLog
  /** Separates challenge digests of audiences that share one store. */
  namespace?: string
  now?: () => number
  server: WebauthnServer
  store: PasskeyStore
  /** Prefix on the user handle when two account tables share one RP ID. */
  userHandlePrefix?: string
}

export interface PasskeyAccount {
  displayName?: string | null
  id: string
  name: string
}

export interface PasskeySummary {
  backedUp: boolean
  createdAt: string
  deviceType: 'multiDevice' | 'singleDevice'
  id: string
  lastUsedAt: string | null
  name: string | null
  transports: string[]
}

/** ES256 for platform authenticators, RS256 for Windows Hello. */
export const SUPPORTED_ALGORITHM_IDS = [-7, -257]
export const CEREMONY_TIMEOUT_MS = 60_000
export const MAX_PASSKEYS_PER_USER = 20

const SILENT_LOG: PasskeyCeremonyLog = { error() {}, info() {}, warn() {} }

function logOf(ctx: PasskeyCeremonyContext): PasskeyCeremonyLog {
  return ctx.log ?? SILENT_LOG
}

function nowMs(ctx: PasskeyCeremonyContext): number {
  return ctx.now ? ctx.now() : Date.now()
}

/** SHA-256 hex of the challenge; the store never holds a presentable value. */
export async function hashWebauthnChallenge(challenge: string, namespace = ''): Promise<string> {
  const bytes = new TextEncoder().encode(`webauthn-challenge\u0000${namespace}\u0000${challenge}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function toPasskeySummary(record: PasskeyCredentialRecord): PasskeySummary {
  return {
    backedUp: record.backedUp,
    createdAt: record.createdAt,
    deviceType: record.deviceType,
    id: record.id,
    lastUsedAt: record.lastUsedAt,
    name: record.name,
    transports: [...record.transports],
  }
}

function userHandle(ctx: PasskeyCeremonyContext, userId: string): string {
  return `${ctx.userHandlePrefix ?? ''}${userId}`
}

function unavailable(ctx: PasskeyCeremonyContext, error: unknown): never {
  logOf(ctx).error('Passkeys unavailable: @simplewebauthn/server failed when called', {
    error: String(error),
  })
  throw createError({ statusCode: 503, statusMessage: PASSKEYS_UNAVAILABLE_MESSAGE })
}

async function issue(
  ctx: PasskeyCeremonyContext,
  challenge: string,
  purpose: WebauthnChallengePurpose,
  userId: string | null,
): Promise<void> {
  const issued = await ctx.store.issueChallenge(
    await hashWebauthnChallenge(challenge, ctx.namespace),
    {
      expiresAt: Math.floor(nowMs(ctx) / 1000) + ctx.config.challengeTtlSeconds,
      purpose,
      userId,
    },
  )
  if (!issued) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Passkey ceremonies are temporarily unavailable. Try again shortly.',
    })
  }
}

/** Claims the presented challenge once; a wrong purpose or an expired row is still burned. */
async function claim(
  ctx: PasskeyCeremonyContext,
  clientDataJSON: string,
  purpose: WebauthnChallengePurpose,
): Promise<{ challenge: string; row: StoredWebauthnChallenge } | null> {
  const presented = readPresentedChallenge(clientDataJSON)
  if (!presented) return null
  const row = await ctx.store.consumeChallenge(
    await hashWebauthnChallenge(presented, ctx.namespace),
  )
  if (!isClaimedChallengeUsable(row, purpose, Math.floor(nowMs(ctx) / 1000)) || !row) return null
  return { challenge: presented, row }
}

// ─── Registration ────────────────────────────────────────────

export async function beginPasskeyRegistration(
  ctx: PasskeyCeremonyContext,
  account: PasskeyAccount,
) {
  const existing = await ctx.store.listCredentials(account.id)
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    throw createError({
      statusCode: 409,
      statusMessage: `This account already has the maximum of ${MAX_PASSKEYS_PER_USER} passkeys.`,
    })
  }

  const options = await ctx.server
    .generateRegistrationOptions({
      rpName: ctx.config.rpName,
      rpID: ctx.config.rpId,
      // The handle is readable by any site the credential is offered to: opaque id, never email.
      userID: new TextEncoder().encode(userHandle(ctx, account.id)),
      userName: account.name,
      userDisplayName: account.displayName ?? account.name,
      attestationType: 'none',
      timeout: CEREMONY_TIMEOUT_MS,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
      excludeCredentials: existing.map((row) => ({ id: row.id, transports: row.transports })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
    })
    .catch((error: unknown) => unavailable(ctx, error))

  await issue(ctx, options.challenge, 'registration', account.id)
  return options
}

export async function finishPasskeyRegistration(
  ctx: PasskeyCeremonyContext,
  account: PasskeyAccount,
  input: { name?: string | null; response: RegistrationResponseJSON },
): Promise<PasskeySummary> {
  const log = logOf(ctx)
  const claimed = await claim(ctx, input.response.response.clientDataJSON, 'registration')
  if (!claimed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This passkey registration challenge is unknown, already used, or expired.',
    })
  }
  // A challenge issued to account A must never enrol a credential onto account B.
  if (claimed.row.userId !== account.id) {
    log.warn('Rejected passkey registration bound to a different account', { userId: account.id })
    throw createError({
      statusCode: 400,
      statusMessage: 'This passkey registration challenge was issued to a different account.',
    })
  }

  const verification = await ctx.server
    .verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: claimed.challenge,
      expectedOrigin: ctx.config.origins,
      expectedRPID: ctx.config.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    })
    .catch((error: unknown) => {
      log.warn('Passkey registration verification failed', { error: String(error) })
      return null
    })
  if (!verification?.verified) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey registration could not be verified.',
    })
  }

  // Re-checked after verification: two concurrent ceremonies both pass the opening check.
  if ((await ctx.store.listCredentials(account.id)).length >= MAX_PASSKEYS_PER_USER) {
    throw createError({
      statusCode: 409,
      statusMessage: `This account already has the maximum of ${MAX_PASSKEYS_PER_USER} passkeys.`,
    })
  }

  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo
  const record: PasskeyCredentialRecord = {
    id: credential.id,
    userId: account.id,
    publicKey: ctx.server.isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    rpId: ctx.config.rpId,
    name: normalizePasskeyName(input.name),
    createdAt: new Date(nowMs(ctx)).toISOString(),
    lastUsedAt: null,
  }
  // No upsert: rebinding an existing credential id to this session would be a takeover.
  if (!(await ctx.store.insertCredential(record))) {
    throw createError({ statusCode: 409, statusMessage: 'This passkey is already registered.' })
  }
  log.info('Passkey registered', { deviceType: credentialDeviceType, userId: account.id })
  return toPasskeySummary(record)
}

// ─── Authentication ──────────────────────────────────────────

/** Discoverable credentials only: the options name no account and reveal none. */
export async function beginPasskeyAuthentication(ctx: PasskeyCeremonyContext) {
  const options = await ctx.server
    .generateAuthenticationOptions({
      rpID: ctx.config.rpId,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'required',
    })
    .catch((error: unknown) => unavailable(ctx, error))
  await issue(ctx, options.challenge, 'authentication', null)
  return options
}

/** Resolves the account a verified assertion proves; every refusal is the same 401. */
export async function finishPasskeyAuthentication(
  ctx: PasskeyCeremonyContext,
  response: AuthenticationResponseJSON,
): Promise<{ credentialId: string; userId: string }> {
  const log = logOf(ctx)
  const refused = () => createError({ statusCode: 401, statusMessage: 'Passkey sign-in failed.' })

  const claimed = await claim(ctx, response.response.clientDataJSON, 'authentication')
  if (!claimed) throw refused()

  const credential = await ctx.store.findCredential(response.id)
  if (!credential) {
    log.warn('Passkey sign-in presented an unknown credential')
    throw refused()
  }
  // A credential minted under another RP ID is refused even with a valid signature.
  if (credential.rpId !== ctx.config.rpId) {
    log.warn('Passkey sign-in refused: credential is bound to a different RP ID')
    throw refused()
  }
  if (response.response.userHandle) {
    const presented = ctx.server.isoBase64URL.toUTF8String(response.response.userHandle)
    if (presented !== userHandle(ctx, credential.userId)) {
      log.warn('Passkey sign-in refused: user handle does not match the stored credential')
      throw refused()
    }
  }

  const verification = await ctx.server
    .verifyAuthenticationResponse({
      response,
      expectedChallenge: claimed.challenge,
      expectedOrigin: ctx.config.origins,
      expectedRPID: ctx.config.rpId,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: ctx.server.isoBase64URL.toBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    })
    .catch((error: unknown) => {
      log.warn('Passkey authentication verification failed', { error: String(error) })
      return null
    })
  if (!verification?.verified) throw refused()

  const verdict = evaluateSignatureCounter(
    credential.counter,
    verification.authenticationInfo.newCounter,
  )
  if (!verdict.ok) {
    log.error('Passkey signature counter regressed — possible cloned authenticator', {
      credentialId: credential.id,
      userId: credential.userId,
    })
    throw refused()
  }

  const advanced = await ctx.store.advanceCredential(credential.id, credential.counter, {
    counter: verdict.nextCounter,
    backedUp: verification.authenticationInfo.credentialBackedUp,
    deviceType: verification.authenticationInfo.credentialDeviceType,
    lastUsedAt: new Date(nowMs(ctx)).toISOString(),
  })
  if (!advanced) {
    log.warn('Passkey sign-in lost the counter update race', { credentialId: credential.id })
    throw refused()
  }
  return { credentialId: credential.id, userId: credential.userId }
}

// ─── Management ──────────────────────────────────────────────

export async function listPasskeys(
  ctx: PasskeyCeremonyContext,
  userId: string,
): Promise<PasskeySummary[]> {
  const rows = await ctx.store.listCredentials(userId)
  return rows.map(toPasskeySummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function removePasskey(
  ctx: PasskeyCeremonyContext,
  userId: string,
  credentialId: string,
): Promise<void> {
  if (!(await ctx.store.deleteCredential(userId, credentialId))) {
    throw createError({ statusCode: 404, statusMessage: 'Passkey not found' })
  }
  logOf(ctx).info('Passkey removed', { userId })
}
