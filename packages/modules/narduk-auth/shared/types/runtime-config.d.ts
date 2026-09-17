import type { NativeAuthClient } from './native-auth'

interface AuthRuntimeConfig {
  nardukSessionGrantRequired: boolean
  authNativeClients: NativeAuthClient[]
  authLocalEmailVerification: boolean
  appBackendPreset: 'default' | 'managed-supabase'
  authBackend: 'local' | 'supabase'
  authAuthorityUrl: string
  authAnonKey: string
  authServiceRoleKey: string
  authStorageKey: string
  supabaseUrl: string
  supabasePublishableKey: string
  supabaseServiceRoleKey: string
  turnstileSecretKey: string
}

interface AuthPublicRuntimeConfig {
  appBackendPreset: 'default' | 'managed-supabase'
  authBackend: 'local' | 'supabase'
  authAuthorityUrl: string
  authLoginPath: string
  authRegisterPath: string
  authCallbackPath: string
  authConfirmPath: string
  authResetPath: string
  authLogoutPath: string
  authRedirectPath: string
  authProviders: string[]
  authEnforceCanonicalHost: boolean
  authPublicSignup: boolean
  authRequireMfa: boolean
  authTurnstileSiteKey: string
  supabaseUrl: string
  supabasePublishableKey: string
}

declare module 'nuxt/schema' {
  interface RuntimeConfig extends AuthRuntimeConfig {}

  interface PublicRuntimeConfig extends AuthPublicRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface RuntimeConfig extends AuthRuntimeConfig {}

  interface PublicRuntimeConfig extends AuthPublicRuntimeConfig {}
}

export {}
