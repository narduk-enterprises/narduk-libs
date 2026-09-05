import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { createError } from 'h3'

import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'

/**
 * The decision half of the passkey ceremonies, kept free of every Nuxt-layer
 * import so it can be unit-tested directly rather than through a stubbed
 * database, session and logger.
 *
 * `webauthn-core.ts` holds the I/O; everything here is a pure function of its
 * arguments.
 */

export const MAX_PASSKEY_NAME_LENGTH = 100

export type SignatureCounterVerdict =
  { nextCounter: number; ok: true } | { ok: false; reason: 'counter-regression' }

/**
 * Clone detection, failing closed (narduk-libs#125 risk R6).
 *
 * An authenticator that maintains a signature counter must report a strictly
 * increasing value. A repeated or lower value means either a replayed
 * assertion or a cloned authenticator, and both are refusals.
 *
 * A counter of `0` on both sides is the documented "this authenticator does
 * not implement a counter" case, which every Apple and Google platform passkey
 * takes, and is the one pairing allowed not to increase. Once a credential has
 * reported a non-zero counter, the strict rule applies forever — an
 * authenticator cannot escape the check by dropping back to `0`.
 */
export function evaluateSignatureCounter(
  storedCounter: number,
  newCounter: number,
): SignatureCounterVerdict {
  if (!Number.isInteger(storedCounter) || !Number.isInteger(newCounter)) {
    return { ok: false, reason: 'counter-regression' }
  }
  if (storedCounter < 0 || newCounter < 0) return { ok: false, reason: 'counter-regression' }
  if (storedCounter === 0 && newCounter === 0) return { ok: true, nextCounter: 0 }
  if (newCounter <= storedCounter) return { ok: false, reason: 'counter-regression' }
  return { ok: true, nextCounter: newCounter }
}

/**
 * Reads the challenge out of a ceremony response's `clientDataJSON`.
 *
 * The value is untrusted — it is only used to look up a challenge row this
 * server issued. Nothing is accepted because the client said so: the row must
 * exist, be unconsumed and unexpired, and `@simplewebauthn/server` then
 * independently re-verifies that the same challenge is bound into the signed
 * client-data hash.
 */
export function readPresentedChallenge(clientDataJSON: string): string | null {
  try {
    const parsed: unknown = JSON.parse(isoBase64URL.toUTF8String(clientDataJSON))
    if (typeof parsed !== 'object' || parsed === null) return null
    const challenge = (parsed as { challenge?: unknown }).challenge
    return typeof challenge === 'string' && challenge.length > 0 ? challenge : null
  } catch {
    return null
  }
}

export function parseTransports(value: string): AuthenticatorTransportFuture[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AuthenticatorTransportFuture => typeof item === 'string')
  } catch {
    return []
  }
}

export function normalizePasskeyName(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_PASSKEY_NAME_LENGTH)
}

export interface ClaimedChallengeRow {
  expiresAt: number
  purpose: string
  userId?: string | null
}

/**
 * Whether a claimed challenge row may be used for this ceremony.
 *
 * The row is deleted by hash *before* this runs, so a challenge presented to
 * the wrong endpoint or after expiry is still consumed — a rejected attempt
 * can never be retried.
 */
export function isClaimedChallengeUsable(
  row: ClaimedChallengeRow | null | undefined,
  expectedPurpose: 'authentication' | 'registration',
  nowSeconds: number,
): boolean {
  if (!row) return false
  if (row.purpose !== expectedPurpose) return false
  return row.expiresAt > nowSeconds
}

/**
 * Passkey management is a **session-only** capability.
 *
 * `requireAuth` accepts an API-key bearer as a first-class principal, so
 * without this guard a leaked or over-scoped API key could enrol a passkey —
 * turning a revocable machine token into a persistent interactive login — or
 * delete the passkeys of the account it belongs to. An API key is a machine
 * credential; changing which authenticators can sign in as a human is not a
 * machine action.
 *
 * It lives in this module rather than beside the ceremonies so a test can call
 * it directly. A guard whose only coverage is "the call site still appears in
 * the source" is satisfied by a no-op body, which is exactly the regression it
 * exists to prevent.
 */
export function assertPasskeyManagementPrincipal(user: { authMethod?: string }): void {
  if (user.authMethod === 'api-key') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Passkeys can only be managed from an interactive session, not an API key.',
    })
  }
}
