import { createError } from 'h3'

import { definePublicMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import {
  issueNativeAppleNonce,
  NATIVE_APPLE_NONCE_TTL_SECONDS,
} from '../../../../lib/app-auth/native-apple-nonce'
import { resolveAppleSignInForEvent } from '../../../../utils/auth-runtime-env'
import { useNativeAuth } from '../../../../utils/native-auth'

/**
 * POST /api/auth/native/apple/nonce — a single-use nonce for native Sign in
 * with Apple. No body. The app sets the SHA-256 hex of `nonce` on its Apple
 * request and sends the raw `nonce` back to `POST /api/auth/native/apple`
 * within `expiresIn` seconds.
 */
export default definePublicMutation(
  { rateLimit: RATE_LIMIT_POLICIES.authLogin },
  async ({ event }) => {
    useNativeAuth(event)
    if (!resolveAppleSignInForEvent(event, 'local').nativeEnabled) {
      throw createError({
        statusCode: 501,
        statusMessage: 'Native Apple sign-in is not configured for this app.',
      })
    }
    return { nonce: await issueNativeAppleNonce(event), expiresIn: NATIVE_APPLE_NONCE_TTL_SECONDS }
  },
)
