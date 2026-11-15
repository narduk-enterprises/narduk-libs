import { z } from 'zod'

import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import { finishPasskeyAuthentication } from '#narduk-auth-server/lib/app-auth/webauthn-core'
import { passkeyAuthenticationResponseSchema } from '#narduk-auth-server/lib/app-auth/webauthn-validation'

import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

const bodySchema = z.object({ response: passkeyAuthenticationResponseSchema })

/**
 * POST /api/auth/passkeys/authentication/verify — sign in with a passkey.
 *
 * Public and rate-limited as `authLogin`. Establishes the session through the
 * same `setCurrentSessionUser` path `loginWithLocalAuth` uses, so nothing
 * downstream of the session cookie changes. Every failure returns one generic
 * 401 so the response never distinguishes an unknown credential from a bad
 * signature.
 */
export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    return finishPasskeyAuthentication(
      event,
      input.response as unknown as AuthenticationResponseJSON,
    )
  },
)
