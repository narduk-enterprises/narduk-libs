import { count, eq, lt } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery } from '#layer/server/utils/database'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import { authWebauthnChallenges } from '#narduk-auth/schema'

import { hashLocalEmailValue } from './local-email-core'
import { isClaimedChallengeUsable } from './webauthn-verification'

import type { H3Event } from 'h3'

export type WebauthnChallengePurpose = 'authentication' | 'registration'

export interface ConsumedWebauthnChallenge {
  expiresAt: number
  purpose: WebauthnChallengePurpose
  userId: string | null
}

type ChallengeRow = typeof authWebauthnChallenges.$inferSelect

/**
 * Challenges are stored as a SHA-256 digest, never in the clear.
 *
 * The challenge itself is sent to the browser, so this is not secrecy of a
 * bearer token — it is the same discipline `auth_email_links` applies: a read
 * of the table yields nothing an attacker can present, and the lookup path is
 * identical either way because the verify endpoint learns the challenge from
 * the ceremony response and hashes it before looking it up.
 */
function hashChallenge(challenge: string): Promise<string> {
  return hashLocalEmailValue(`webauthn-challenge\u0000${challenge}`)
}

export function isMissingWebauthnTableError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const message =
      'message' in current && typeof current.message === 'string' ? current.message : ''
    if (
      /auth_webauthn_(?:credentials|challenges)/u.test(message) &&
      (/no such table/iu.test(message) || /does not exist/iu.test(message))
    ) {
      return true
    }
    current = 'cause' in current ? current.cause : null
  }
  return false
}

/**
 * Absolute ceiling on live (unexpired) challenge rows.
 *
 * `POST /api/auth/passkeys/authentication/options` is necessarily public — it
 * is sign-in — and inserts a row per call. Its rate limit is keyed on the
 * client IP, so an attacker rotating source addresses is bounded only by the
 * number of addresses they hold. This ceiling is the bound that does not
 * depend on the caller's identity.
 *
 * Set well above any plausible honest concurrency: a single operator's portal
 * issues a handful of challenges a day, and each lives at most 900 seconds.
 * When it trips, sign-in and enrolment refuse with 503 while password login —
 * which touches neither table — keeps working, so the ceiling degrades one
 * affordance rather than locking the account out (narduk-libs#125 D2).
 */
export const MAX_LIVE_WEBAUTHN_CHALLENGES = 5000

export async function issueWebauthnChallenge(
  event: H3Event,
  params: {
    challenge: string
    purpose: WebauthnChallengePurpose
    ttlSeconds: number
    userId?: string | null
  },
): Promise<void> {
  const appDb = useAuthBridgeDatabase(event)
  const now = Math.floor(Date.now() / 1000)

  // Opportunistic sweep: expired rows are unusable, and nothing else prunes
  // them on a Worker with no cron. Bounded to one statement per issue.
  await executeDatabaseQuery(
    appDb.delete(authWebauthnChallenges).where(lt(authWebauthnChallenges.expiresAt, now)),
  )

  const [live] = await executeDatabaseQuery<Array<{ value: number }>>(
    appDb.select({ value: count() }).from(authWebauthnChallenges),
  )
  if ((live?.value ?? 0) >= MAX_LIVE_WEBAUTHN_CHALLENGES) {
    // Counted after the sweep above, so this reflects live rows, not debris.
    throw createError({
      statusCode: 503,
      statusMessage: 'Passkey ceremonies are temporarily unavailable. Try again shortly.',
    })
  }

  await executeDatabaseQuery(
    appDb.insert(authWebauthnChallenges).values({
      challengeHash: await hashChallenge(params.challenge),
      purpose: params.purpose,
      userId: params.userId ?? null,
      expiresAt: now + params.ttlSeconds,
      createdAt: new Date().toISOString(),
    }),
  )
}

/**
 * Claims a challenge exactly once.
 *
 * The row is deleted by hash alone and only then checked for purpose and
 * expiry, so presenting a registration challenge to the authentication verify
 * endpoint still burns it. A caller that gets `null` must refuse the ceremony:
 * either the challenge was never issued, or it has already been used, or it
 * expired.
 */
export async function consumeWebauthnChallenge(
  event: H3Event,
  params: {
    challenge: string
    purpose: WebauthnChallengePurpose
  },
): Promise<ConsumedWebauthnChallenge | null> {
  const appDb = useAuthBridgeDatabase(event)
  const challengeHash = await hashChallenge(params.challenge)

  const deleted = await executeDatabaseQuery<ChallengeRow[]>(
    appDb
      .delete(authWebauthnChallenges)
      .where(eq(authWebauthnChallenges.challengeHash, challengeHash))
      .returning(),
  )

  const row = Array.isArray(deleted) ? deleted[0] : undefined
  if (!isClaimedChallengeUsable(row, params.purpose, Math.floor(Date.now() / 1000))) return null
  if (!row) return null

  return {
    expiresAt: row.expiresAt,
    purpose: row.purpose,
    userId: row.userId ?? null,
  }
}
