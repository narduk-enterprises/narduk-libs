import { randomAppleToken } from './apple-identity'
import { consumeWebauthnChallenge, issueWebauthnChallenge } from './webauthn-challenges'

import type { H3Event } from 'h3'

/**
 * Server-issued, single-use nonces for `POST /api/auth/native/apple`.
 *
 * A client-chosen nonce binds an Apple identity token to the app, but nothing
 * stops the same token and nonce being presented again until the token
 * expires. Native tokens last 30 days, so the native route only accepts a nonce
 * this server issued and claims it before the token is verified: a token can be
 * traded once, and a refused attempt burns its nonce.
 *
 * Stored hashed in `auth_webauthn_challenges` (migration 0003), under a prefix
 * no passkey challenge can equal, so neither ceremony can redeem the other's
 * value. That table's live-row ceiling also bounds this public issuer.
 */
const NONCE_PREFIX = 'native-apple\u0000'
export const NATIVE_APPLE_NONCE_TTL_SECONDS = 300

export async function issueNativeAppleNonce(event: H3Event): Promise<string> {
  const nonce = randomAppleToken()
  await issueWebauthnChallenge(event, {
    challenge: `${NONCE_PREFIX}${nonce}`,
    purpose: 'authentication',
    ttlSeconds: NATIVE_APPLE_NONCE_TTL_SECONDS,
    userId: null,
  })
  return nonce
}

/** Claims the nonce exactly once; `false` when it was never issued, is spent or expired. */
export async function consumeNativeAppleNonce(event: H3Event, nonce: string): Promise<boolean> {
  const claimed = await consumeWebauthnChallenge(event, {
    challenge: `${NONCE_PREFIX}${nonce}`,
    purpose: 'authentication',
  })
  return claimed !== null
}
