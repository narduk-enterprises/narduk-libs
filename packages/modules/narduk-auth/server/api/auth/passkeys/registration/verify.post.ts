import { z } from 'zod'

import {
  defineUserMutation,
  requireMutationBody,
  withValidatedBody,
} from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  assertPasskeyManagementPrincipal,
  finishPasskeyRegistration,
} from '#narduk-auth-server/lib/app-auth/webauthn-core'

import type { RegistrationResponseJSON } from '@simplewebauthn/server'

const registrationResponseSchema = z.object({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  authenticatorAttachment: z.string().max(32).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  response: z.object({
    attestationObject: z.string().min(1).max(32_768),
    clientDataJSON: z.string().min(1).max(8192),
    authenticatorData: z.string().max(32_768).optional(),
    publicKey: z.string().max(8192).optional(),
    publicKeyAlgorithm: z.number().optional(),
    transports: z.array(z.string().max(32)).max(16).optional(),
  }),
})

const bodySchema = z.object({
  name: z.string().max(100).nullable().optional(),
  response: registrationResponseSchema,
})

/**
 * POST /api/auth/passkeys/registration/verify — enrol the passkey.
 *
 * `defineUserMutation` for the same reason as the options route above: this is
 * enrolment, not sign-in. See narduk-libs#125 gap G5.
 */
export default defineUserMutation(
  {
    rateLimit: RATE_LIMIT_POLICIES.authApiKeys,
    parseBody: withValidatedBody(bodySchema.parse),
  },
  async ({ event, user, body }) => {
    assertPasskeyManagementPrincipal(user)
    const input = requireMutationBody(body)
    return finishPasskeyRegistration(
      event,
      { id: user.id, email: user.email },
      {
        name: input.name ?? null,
        response: input.response as unknown as RegistrationResponseJSON,
      },
    )
  },
)
