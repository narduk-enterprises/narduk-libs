import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ISSUER, hashAppleNonce } from '../server/lib/app-auth/apple-identity'
import { resolveAppleSignInConfig } from '../shared/utils/apple-sign-in-config'

import { appleTestKeys, signAppleToken } from './fixtures/apple-tokens'

import type * as AppleLocal from '../server/lib/app-auth/apple-local'
import type { AppleSignInConfig } from '../shared/utils/apple-sign-in-config'
import type { H3Event } from 'h3'

/**
 * narduk-libs#164: the local backend's entry points. `startOAuthFlow` and
 * `signInWithNativeApple` used to 501 unless the backend was Supabase.
 */

const state = vi.hoisted(() => ({
  apple: null as AppleSignInConfig | null,
  backend: 'local' as 'local' | 'supabase',
  signedIn: [] as Array<{ appleId: string; email: string | null }>,
}))

vi.mock('../server/lib/app-auth/linking', () => ({ ensureLinkedLocalUser: vi.fn() }))
vi.mock('../server/lib/app-auth/session', () => ({
  establishLocalSessionUser: vi.fn(),
  getCurrentSessionUser: vi.fn(),
  getCurrentSupabaseContext: vi.fn(),
  persistSupabaseSession: vi.fn(),
  setCurrentSessionUser: vi.fn(),
}))
vi.mock('../server/utils/verified-email', () => ({
  getLocalEmailVerification: async () => null,
  recordLocalEmailVerification: vi.fn(),
}))
vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({
    backend: state.backend,
    publicSignup: true,
    providers: ['apple', 'email'],
    appUrl: 'https://app.example',
    callbackPath: '/auth/callback',
    redirectPath: '/dashboard/',
  }),
  isSupabaseConfigured: () => false,
  createSupabaseUserClient: vi.fn(),
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))
vi.mock('../server/utils/auth-runtime-env', () => ({
  resolveAppleSignInForEvent: () => state.apple,
}))
vi.mock('../server/lib/app-auth/apple-local', async (importOriginal) => {
  const original = await importOriginal<typeof AppleLocal>()
  return {
    ...original,
    signInWithAppleIdentity: async (
      _event: unknown,
      claims: { appleId: string; email: string },
    ) => {
      state.signedIn.push({ appleId: claims.appleId, email: claims.email })
      return { id: 'user-1', email: claims.email, name: 'Pat', isAdmin: false }
    },
  }
})

const event = { context: {} } as H3Event
const NATIVE_RAW = 'native-raw'
const CONFIGURED: AppleSignInConfig = {
  nativeClientIds: ['com.example.ios'],
  nativeEnabled: true,
  servicesId: 'com.example.web',
  webEnabled: true,
}

async function nativeToken(rawNonce: string, aud = 'com.example.ios') {
  const now = Math.floor(Date.now() / 1000)
  return signAppleToken({
    iss: APPLE_ISSUER,
    aud,
    sub: 'apple-sub-9',
    iat: now,
    exp: now + 600,
    nonce: await hashAppleNonce(rawNonce),
    email: 'pat@example.com',
    email_verified: true,
  })
}

describe('local-backend Apple entry points (#164)', () => {
  beforeEach(async () => {
    vi.resetModules()
    state.apple = CONFIGURED
    state.backend = 'local'
    state.signedIn = []
    const { publicJwk } = await appleTestKeys()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })),
    )
    const { resetAppleJwksCache } = await import('../server/lib/app-auth/apple-identity')
    resetAppleJwksCache()
  })

  it('startOAuthFlow hands the card the same-origin Apple start URL', async () => {
    const { startOAuthFlow } = await import('../server/lib/app-auth/auth-flows')
    await expect(
      startOAuthFlow(event, { provider: 'apple', next: '/farm/2?tab=a' }),
    ).resolves.toEqual({
      url: 'https://app.example/api/auth/apple/start?next=%2Ffarm%2F2%3Ftab%3Da',
    })
    await expect(
      startOAuthFlow(event, { provider: 'apple', next: 'https://evil.example/' }),
    ).resolves.toEqual({ url: 'https://app.example/api/auth/apple/start?next=%2Fdashboard%2F' })
  })

  it('startOAuthFlow still answers 501 when Apple is not configured', async () => {
    state.apple = { ...CONFIGURED, servicesId: '', webEnabled: false }
    const { startOAuthFlow } = await import('../server/lib/app-auth/auth-flows')
    await expect(startOAuthFlow(event, { provider: 'apple' })).rejects.toMatchObject({
      statusCode: 501,
    })
  })

  it('signInWithNativeApple verifies a bundle-id token with its nonce and signs in', async () => {
    const { signInWithNativeApple } = await import('../server/lib/app-auth/auth-flows')
    const result = await signInWithNativeApple(event, {
      identityToken: await nativeToken(NATIVE_RAW),
      nonce: NATIVE_RAW,
    })
    expect(result).toMatchObject({ nextStep: 'signed_in', redirectTo: '/dashboard/' })
    expect(state.signedIn).toEqual([{ appleId: 'apple-sub-9', email: 'pat@example.com' }])
  })

  it('signInWithNativeApple requires the nonce and the native audience', async () => {
    const { signInWithNativeApple } = await import('../server/lib/app-auth/auth-flows')
    await expect(
      signInWithNativeApple(event, { identityToken: await nativeToken(NATIVE_RAW) }),
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      signInWithNativeApple(event, {
        identityToken: await nativeToken(NATIVE_RAW, 'com.example.web'),
        nonce: NATIVE_RAW,
      }),
    ).rejects.toMatchObject({ statusCode: 401, data: { reason: 'wrong_audience' } })
    await expect(
      signInWithNativeApple(event, {
        identityToken: await nativeToken(NATIVE_RAW),
        nonce: 'replayed-elsewhere',
      }),
    ).rejects.toMatchObject({ data: { reason: 'nonce_mismatch' } })
    expect(state.signedIn).toEqual([])
  })

  it('signInWithNativeApple answers 501 when no native client id is configured', async () => {
    state.apple = { ...CONFIGURED, nativeClientIds: [], nativeEnabled: false }
    const { signInWithNativeApple } = await import('../server/lib/app-auth/auth-flows')
    await expect(
      signInWithNativeApple(event, { identityToken: 'x.y.z', nonce: 'n' }),
    ).rejects.toMatchObject({ statusCode: 501 })
  })
})

describe('resolveAppleSignInConfig (#164)', () => {
  it('enables local Apple only when advertised and bound to client ids', () => {
    const env = {
      AUTH_APPLE_SERVICES_ID: ' com.example.web ',
      AUTH_APPLE_NATIVE_CLIENT_IDS: 'com.example.ios, com.example.ios,com.example.mac',
    }
    expect(
      resolveAppleSignInConfig({ authBackend: 'local', authProviders: ['email', 'apple'], env }),
    ).toEqual({
      nativeClientIds: ['com.example.ios', 'com.example.mac'],
      nativeEnabled: true,
      servicesId: 'com.example.web',
      webEnabled: true,
    })
    expect(
      resolveAppleSignInConfig({ authBackend: 'local', authProviders: ['email'], env }),
    ).toMatchObject({ nativeEnabled: false, webEnabled: false })
    expect(
      resolveAppleSignInConfig({
        authBackend: 'local',
        authProviders: ['email', 'apple'],
        env: {},
      }),
    ).toMatchObject({ nativeEnabled: false, webEnabled: false })
  })

  it('keeps the Supabase backend on the advertisement alone', () => {
    expect(
      resolveAppleSignInConfig({ authBackend: 'supabase', authProviders: ['apple'], env: {} }),
    ).toMatchObject({ nativeEnabled: true, webEnabled: true })
  })
})
