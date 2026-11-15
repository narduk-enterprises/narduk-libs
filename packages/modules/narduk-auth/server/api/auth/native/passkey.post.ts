import { useLogger } from '#layer/server/utils/logger'
import {
  definePublicMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'

import { nativePasskeySchema } from '../../../lib/app-auth/native-validation'
import { verifyPasskeyAssertion } from '../../../lib/app-auth/webauthn-core'
import { useNativeAuthForClient } from '../../../utils/native-auth'

import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

/**
 * POST /api/auth/native/passkey — trade a passkey assertion for native tokens.
 *
 * The app takes a challenge from `POST /api/auth/passkeys/authentication/options`
 * (public, no body, stored server-side, no cookie), has the platform sign it,
 * and posts `{ clientId, response }`. The assertion goes through the same
 * verification as the cookie sign-in (`verifyPasskeyAssertion`: single-use
 * challenge, configured RP ID and origins, user verification, signature
 * counter), then a native session is issued for the configured client instead
 * of a cookie. Answers like `POST /api/auth/native/token`; every assertion
 * failure is the same generic 401.
 */
export default definePublicMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authLogin,
    parseBody: withValidatedBody(nativePasskeySchema.parse),
  },
  async ({ event, body }) => {
    const input = requireMutationBody(body)
    const native = useNativeAuthForClient(event, input.clientId)
    const user = await verifyPasskeyAssertion(
      event,
      input.response as unknown as AuthenticationResponseJSON,
    )
    const tokens = await native.issueSession(user.id, input.clientId, 'passkey')
    useLogger(event)
      .child('AppAuth')
      .info('Native passkey sign-in succeeded', { clientId: input.clientId, userId: user.id })
    return tokens
  },
)
