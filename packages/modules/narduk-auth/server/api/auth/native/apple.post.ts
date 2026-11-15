import { createError } from 'h3'

import { useLogger } from '#layer/server/utils/logger'
import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import { resolveAppleIdentityUser } from '../../../lib/app-auth/apple-local'
import { verifyNativeAppleIdentity } from '../../../lib/app-auth/auth-flows'
import { consumeNativeAppleNonce } from '../../../lib/app-auth/native-apple-nonce'
import { nativeAppleSchema } from '../../../lib/app-auth/native-validation'
import { useNativeAuthForClient } from '../../../utils/native-auth'

const APPLE_REFUSED = 'Apple sign-in could not be verified.'

/**
 * POST /api/auth/native/apple — trade a native Sign in with Apple credential
 * for native tokens.
 *
 * `nonce` must come from `POST /api/auth/native/apple/nonce` and is claimed
 * before the token is looked at, so each identity token is traded at most once.
 * The token is then verified as `signInWithNativeApple` does it (Apple's keys,
 * `iss`, `exp`, `aud` in `AUTH_APPLE_NATIVE_CLIENT_IDS`, the SHA-256 of the
 * nonce), and the account is found, linked or created by the same rules as the
 * web Apple sign-in. A native session is issued for the configured client
 * instead of a cookie. An Apple-only account with no password is accepted: the
 * verified Apple identity is its sign-in (Logan, 2026-11-15). Answers like
 * `POST /api/auth/native/token`; every token refusal is one generic 401.
 */
export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(nativeAppleSchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const native = useNativeAuthForClient(event, input.clientId)
    const log = useLogger(event).child('AppAuth')
    if (!(await consumeNativeAppleNonce(event, input.nonce))) {
      log.warn('Native Apple sign-in refused', { reason: 'nonce_unknown' })
      throw createError({ statusCode: 401, statusMessage: APPLE_REFUSED })
    }
    const claims = await verifyNativeAppleIdentity(event, {
      identityToken: input.identityToken,
      nonce: input.nonce,
    }).catch((error: unknown) => {
      if ((error as { statusCode?: unknown } | null)?.statusCode !== 401) throw error
      // `reason` is a fixed code from verifyAppleIdentityToken; it stays in the
      // log, never the token, and never the response.
      const reason = (error as { data?: { reason?: unknown } }).data?.reason
      log.warn('Native Apple sign-in refused', {
        reason: typeof reason === 'string' ? reason : 'verification_failed',
      })
      throw createError({ statusCode: 401, statusMessage: APPLE_REFUSED })
    })
    const { user } = await resolveAppleIdentityUser(event, claims, {
      displayName: input.displayName ?? null,
    })
    const tokens = await native.issueSession(user.id, input.clientId, 'apple')
    log.info('Native Apple sign-in succeeded', { clientId: input.clientId, userId: user.id })
    return tokens
  },
)
