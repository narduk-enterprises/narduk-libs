import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { authWebauthnCredentials } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import {
  readAuthRuntimeEnv,
  resolveAuthEnvironmentForEvent,
} from '#narduk-auth-server/utils/auth-runtime-env'
import { type User as LocalUser, users } from '#narduk-core/schema'

import {
  describeWebauthnDisabledReason,
  type ResolvedWebauthnConfig,
  resolveWebauthnConfig,
  type WebauthnConfig,
} from '../../../shared/utils/webauthn-config'

import { establishLocalSessionUser } from './session'
import { consumeWebauthnChallenge, issueWebauthnChallenge } from './webauthn-challenges'
import {
  type AuthenticationResponseJSON,
  loadWebauthnServer,
  PASSKEYS_UNAVAILABLE_MESSAGE,
  type RegistrationResponseJSON,
  type WebauthnServer,
} from './webauthn-server'
import {
  assertPasskeyManagementPrincipal,
  evaluateSignatureCounter,
  normalizePasskeyName,
  parseTransports,
  readPresentedChallenge,
} from './webauthn-verification'

import type { AppSessionUser } from './types'
import type { H3Event } from 'h3'

// Re-exported so the routes keep one import site for the passkey surface; the
// implementation lives in webauthn-verification.ts because it is directly
// unit-testable there.
export { assertPasskeyManagementPrincipal }

type CredentialRow = typeof authWebauthnCredentials.$inferSelect

/**
 * ES256 and RS256 only.
 *
 * Every platform authenticator Logan will use produces ES256; RS256 is kept
 * for Windows Hello. Narrowing the list narrows the COSE parsing surface the
 * verifier is asked to accept.
 */
const SUPPORTED_ALGORITHM_IDS = [-7, -257]
const CEREMONY_TIMEOUT_MS = 60_000
const MAX_PASSKEYS_PER_USER = 20

export interface PasskeySummary {
  backedUp: boolean
  createdAt: string
  deviceType: 'multiDevice' | 'singleDevice'
  id: string
  lastUsedAt: string | null
  name: string | null
  transports: string[]
}

// ─── Configuration ───────────────────────────────────────────

export function getWebauthnConfig(event: H3Event): WebauthnConfig {
  const environment = resolveAuthEnvironmentForEvent(event)
  return resolveWebauthnConfig({
    authBackend: environment.authBackend,
    authProviders: environment.authProviders,
    env: readAuthRuntimeEnv(event),
  })
}

/**
 * Fail closed: a route that cannot resolve a complete Relying Party
 * configuration refuses the ceremony with 501 rather than falling back to a
 * guessed RP ID or the request's own `Host` header. Deriving the RP ID from
 * the request would let anyone who can reach the Worker on another hostname
 * mint credentials scoped to that hostname.
 */
export function requireWebauthnConfig(event: H3Event): ResolvedWebauthnConfig {
  const config = getWebauthnConfig(event)
  if (!config.enabled) {
    throw createError({
      statusCode: 501,
      statusMessage: `Passkeys are not available. ${describeWebauthnDisabledReason(config.reason)}`,
    })
  }
  return config
}

// ─── Row mapping ─────────────────────────────────────────────

export function toPasskeySummary(row: CredentialRow): PasskeySummary {
  return {
    backedUp: row.backedUp,
    createdAt: row.createdAt,
    deviceType: row.deviceType,
    id: row.id,
    lastUsedAt: row.lastUsedAt,
    name: row.name,
    transports: parseTransports(row.transports),
  }
}

// ─── Storage ─────────────────────────────────────────────────

async function listCredentialRows(event: H3Event, userId: string): Promise<CredentialRow[]> {
  const appDb = useAuthBridgeDatabase(event)
  return executeDatabaseQuery<CredentialRow[]>(
    appDb.select().from(authWebauthnCredentials).where(eq(authWebauthnCredentials.userId, userId)),
  )
}

export async function listPasskeys(event: H3Event, userId: string): Promise<PasskeySummary[]> {
  const rows = await listCredentialRows(event, userId)
  return rows.map(toPasskeySummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function deletePasskey(
  event: H3Event,
  userId: string,
  credentialId: string,
): Promise<void> {
  const appDb = useAuthBridgeDatabase(event)
  const deleted = await executeDatabaseQuery<CredentialRow[]>(
    appDb
      .delete(authWebauthnCredentials)
      .where(
        and(
          eq(authWebauthnCredentials.id, credentialId),
          eq(authWebauthnCredentials.userId, userId),
        ),
      )
      .returning(),
  )

  if (!Array.isArray(deleted) || deleted.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Passkey not found' })
  }

  useLogger(event).child('AppAuth').info('Passkey removed', { userId })
}

/**
 * `@simplewebauthn/server`, loaded on first use. A load or initialization
 * failure is logged with its cause here and answered 503 by the loader, so a
 * broken bundle no longer surfaces as an opaque 500 (narduk-libs#892). Every
 * ceremony calls this before any side effect.
 */
function useWebauthnServer(event: H3Event): Promise<WebauthnServer> {
  return loadWebauthnServer((error) => {
    useLogger(event)
      .child('AppAuth')
      .error('Passkeys unavailable: @simplewebauthn/server failed to load', {
        error: describeLoadFailure(error),
      })
  })
}

/**
 * A throw from the library's option generators, which read only server state
 * (config, the session user, stored credentials) and nothing from the request
 * body: it is the runtime or the bundle, the #892 misconfiguration met one step
 * after the load. Logged with its cause and
 * answered with the loader's 503 rather than an opaque 500 (narduk-libs#1060).
 */
function passkeysUnavailable(event: H3Event, error: unknown): never {
  useLogger(event)
    .child('AppAuth')
    .error('Passkeys unavailable: @simplewebauthn/server failed when called', {
      error: describeLoadFailure(error),
    })
  throw createError({ statusCode: 503, statusMessage: PASSKEYS_UNAVAILABLE_MESSAGE })
}

/** The error and its `cause` chain, one line each: a bundler often wraps the real failure. */
function describeLoadFailure(error: unknown): string {
  const lines: string[] = []
  let current: unknown = error
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    lines.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return lines.join('\ncaused by ')
}

// ─── Registration ceremony ───────────────────────────────────

export async function startPasskeyRegistration(
  event: H3Event,
  user: { email: string; id: string },
) {
  const config = requireWebauthnConfig(event)
  const { generateRegistrationOptions } = await useWebauthnServer(event)
  const existing = await listCredentialRows(event, user.id)
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    throw createError({
      statusCode: 409,
      statusMessage: `This account already has the maximum of ${MAX_PASSKEYS_PER_USER} passkeys.`,
    })
  }

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    // The user handle is stored on the authenticator and can be read back by
    // any site the credential is offered to, so it is the opaque user id —
    // never the email address.
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.email,
    // No attestation is requested: this RP does not run an authenticator
    // allowlist, so a signed attestation statement would be collected and
    // never acted on, at the cost of parsing attacker-supplied x5c chains.
    attestationType: 'none',
    timeout: CEREMONY_TIMEOUT_MS,
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    excludeCredentials: existing.map((row) => ({
      id: row.id,
      transports: parseTransports(row.transports),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
  }).catch((error: unknown) => passkeysUnavailable(event, error))

  await issueWebauthnChallenge(event, {
    challenge: options.challenge,
    purpose: 'registration',
    ttlSeconds: config.challengeTtlSeconds,
    userId: user.id,
  })

  return options
}

export async function finishPasskeyRegistration(
  event: H3Event,
  user: { email: string; id: string },
  input: { name?: string | null; response: RegistrationResponseJSON },
): Promise<PasskeySummary> {
  const config = requireWebauthnConfig(event)
  const { isoBase64URL, verifyRegistrationResponse } = await useWebauthnServer(event)
  const log = useLogger(event).child('AppAuth')

  const presented = readPresentedChallenge(input.response.response.clientDataJSON)
  if (!presented) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Malformed passkey registration response.',
    })
  }

  // Claimed before verification, so a failed verification burns the challenge
  // and cannot be retried as an oracle.
  const claimed = await consumeWebauthnChallenge(event, {
    challenge: presented,
    purpose: 'registration',
  })
  if (!claimed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This passkey registration challenge is unknown, already used, or expired.',
    })
  }

  // The challenge was issued to a specific signed-in user. Binding it back to
  // the session user is what stops a challenge issued for account A from
  // enrolling a credential onto account B.
  if (claimed.userId !== user.id) {
    log.warn('Rejected passkey registration bound to a different account', { userId: user.id })
    throw createError({
      statusCode: 400,
      statusMessage: 'This passkey registration challenge was issued to a different account.',
    })
  }

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: presented,
    expectedOrigin: config.origins,
    expectedRPID: config.rpId,
    requireUserVerification: true,
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
  }).catch((error: unknown) => {
    log.warn('Passkey registration verification failed', { error: String(error) })
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey registration could not be verified.',
    })
  })

  if (!verification.verified) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey registration could not be verified.',
    })
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  // Re-checked here, not only at `startPasskeyRegistration`: two ceremonies
  // started concurrently both pass the opening check and would both insert.
  // This narrows the window to the verification itself rather than to the whole
  // round trip through the authenticator.
  const stored = await listCredentialRows(event, user.id)
  if (stored.length >= MAX_PASSKEYS_PER_USER) {
    throw createError({
      statusCode: 409,
      statusMessage: `This account already has the maximum of ${MAX_PASSKEYS_PER_USER} passkeys.`,
    })
  }

  const appDb = useAuthBridgeDatabase(event)
  const row = {
    id: credential.id,
    userId: user.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? []),
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    rpId: config.rpId,
    name: normalizePasskeyName(input.name),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  } satisfies typeof authWebauthnCredentials.$inferInsert

  // No upsert: a credential ID that already exists belongs to whoever
  // registered it first, and silently rebinding it to the current session
  // would be a takeover primitive. `excludeCredentials` already stops an
  // honest re-registration.
  await executeDatabaseQuery(appDb.insert(authWebauthnCredentials).values(row)).catch(
    (error: unknown) => {
      log.warn('Passkey registration insert rejected', { error: String(error), userId: user.id })
      throw createError({
        statusCode: 409,
        statusMessage: 'This passkey is already registered.',
      })
    },
  )

  log.info('Passkey registered', { deviceType: credentialDeviceType, userId: user.id })
  return toPasskeySummary(row as CredentialRow)
}

// ─── Authentication ceremony ─────────────────────────────────

export async function startPasskeyAuthentication(event: H3Event) {
  const config = requireWebauthnConfig(event)
  const { generateAuthenticationOptions } = await useWebauthnServer(event)

  // Discoverable credentials only, and therefore no `allowCredentials`: the
  // ceremony takes no email and no user identifier, so this endpoint reveals
  // nothing about which accounts exist or which of them have a passkey.
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'required',
  }).catch((error: unknown) => passkeysUnavailable(event, error))

  await issueWebauthnChallenge(event, {
    challenge: options.challenge,
    purpose: 'authentication',
    ttlSeconds: config.challengeTtlSeconds,
    userId: null,
  })

  return options
}

export async function finishPasskeyAuthentication(
  event: H3Event,
  response: AuthenticationResponseJSON,
): Promise<{ user: AppSessionUser }> {
  const config = requireWebauthnConfig(event)
  const { isoBase64URL, verifyAuthenticationResponse } = await useWebauthnServer(event)
  const log = useLogger(event).child('AppAuth')
  const genericFailure = createError({
    statusCode: 401,
    statusMessage: 'Passkey sign-in failed.',
  })

  const presented = readPresentedChallenge(response.response.clientDataJSON)
  if (!presented) throw genericFailure

  const claimed = await consumeWebauthnChallenge(event, {
    challenge: presented,
    purpose: 'authentication',
  })
  if (!claimed) throw genericFailure

  const appDb = useAuthBridgeDatabase(event)
  const credential = await getDatabaseRow<CredentialRow>(
    appDb.select().from(authWebauthnCredentials).where(eq(authWebauthnCredentials.id, response.id)),
  )
  if (!credential) {
    log.warn('Passkey sign-in presented an unknown credential')
    throw genericFailure
  }

  // A credential minted under a different Relying Party ID is refused even if
  // the signature checks out — the deployment's RP ID changing must not
  // silently carry old credentials forward.
  if (credential.rpId !== config.rpId) {
    log.warn('Passkey sign-in refused: credential is bound to a different RP ID')
    throw genericFailure
  }

  // The authenticator's user handle must be the account the stored credential
  // belongs to. A mismatch means the response was assembled from parts.
  if (response.response.userHandle) {
    const presentedUserId = isoBase64URL.toUTF8String(response.response.userHandle)
    if (presentedUserId !== credential.userId) {
      log.warn('Passkey sign-in refused: user handle does not match the stored credential')
      throw genericFailure
    }
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: presented,
    expectedOrigin: config.origins,
    expectedRPID: config.rpId,
    requireUserVerification: true,
    credential: {
      id: credential.id,
      publicKey: isoBase64URL.toBuffer(credential.publicKey),
      counter: credential.counter,
      transports: parseTransports(credential.transports),
    },
  }).catch((error: unknown) => {
    log.warn('Passkey authentication verification failed', { error: String(error) })
    throw genericFailure
  })

  if (!verification.verified) throw genericFailure

  const verdict = evaluateSignatureCounter(
    credential.counter,
    verification.authenticationInfo.newCounter,
  )
  if (!verdict.ok) {
    log.error('Passkey signature counter regressed — possible cloned authenticator', {
      credentialId: credential.id,
      newCounter: verification.authenticationInfo.newCounter,
      storedCounter: credential.counter,
      userId: credential.userId,
    })
    throw genericFailure
  }

  // Conditional on the counter we verified against, so two assertions racing
  // on the same credential cannot both be accepted.
  const updated = await executeDatabaseQuery<CredentialRow[]>(
    appDb
      .update(authWebauthnCredentials)
      .set({
        counter: verdict.nextCounter,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        deviceType: verification.authenticationInfo.credentialDeviceType,
        lastUsedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(authWebauthnCredentials.id, credential.id),
          eq(authWebauthnCredentials.counter, credential.counter),
        ),
      )
      .returning(),
  )
  if (!Array.isArray(updated) || updated.length === 0) {
    log.warn('Passkey sign-in lost the counter update race', { credentialId: credential.id })
    throw genericFailure
  }

  const db = useDatabase(event)
  const user = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.id, credential.userId)),
  )
  if (!user) {
    log.warn('Passkey sign-in resolved a credential whose user no longer exists')
    throw genericFailure
  }

  const sessionUser = await establishLocalSessionUser(event, user, {
    authProvider: 'passkey',
    authProviders: user.appleId ? ['passkey', 'apple', 'email'] : ['passkey', 'email'],
    needsPasswordSetup: false,
  })
  log.info('Passkey sign-in succeeded', { userId: user.id })

  return { user: sessionUser }
}
