import { z } from 'zod'

import { passkeyAuthenticationResponseSchema } from './webauthn-validation'

export const nativeAuthorizationSchema = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().url().max(500),
  codeChallenge: z.string().regex(/^[\w-]{43}$/),
  codeChallengeMethod: z.literal('S256'),
  state: z.string().regex(/^[\w-]{32,128}$/),
})

export const nativeExchangeSchema = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().url().max(500),
  code: z.string().regex(/^[\w-]{43}$/),
  codeVerifier: z.string().regex(/^[\w.~-]{43,128}$/),
})

/** A passkey assertion over a challenge from `POST /api/auth/passkeys/authentication/options`. */
export const nativePasskeySchema = z.object({
  clientId: z.string().min(1).max(100),
  response: passkeyAuthenticationResponseSchema,
})

/**
 * A native Sign in with Apple credential. `nonce` is the raw nonce from
 * `POST /api/auth/native/apple/nonce`, whose SHA-256 hex the token carries.
 */
export const nativeAppleSchema = z.object({
  clientId: z.string().min(1).max(100),
  identityToken: z.string().min(1).max(8192),
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  /** Apple shares the name once, on the first authorization; used only when creating the account. */
  displayName: z.string().trim().min(1).max(200).nullish(),
})

export const nativeRefreshSchema = z.object({
  clientId: z.string().min(1).max(100),
  refreshToken: z.string().regex(/^[\w-]{43}$/),
})
