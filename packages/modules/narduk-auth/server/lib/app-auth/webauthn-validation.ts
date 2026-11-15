import { z } from 'zod'

/**
 * A WebAuthn authentication response (`AuthenticationResponseJSON`) as the
 * browser or a native app sends it, bounded before it reaches the verifier.
 * Shared by the cookie sign-in route and the native passkey route.
 */
export const passkeyAuthenticationResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal('public-key'),
    authenticatorAttachment: z.string().max(32).optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    response: z.object({
      authenticatorData: z.string().min(1).max(32_768),
      clientDataJSON: z.string().min(1).max(8192),
      signature: z.string().min(1).max(8192),
      userHandle: z.string().max(1024).nullish(),
    }),
  })
  // The WebAuthn spec defines `id` as the base64url encoding of `rawId`. A body
  // where they disagree is malformed; catching it here keeps the verifier from
  // being handed a credential whose two identifiers point at different rows.
  .refine((value) => value.id === value.rawId, {
    message: 'id and rawId must encode the same credential',
    path: ['rawId'],
  })
