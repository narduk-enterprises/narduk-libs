import { z } from 'zod'

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

export const nativeRefreshSchema = z.object({
  clientId: z.string().min(1).max(100),
  refreshToken: z.string().regex(/^[\w-]{43}$/),
})
