import type { User as LocalUser } from '#layer/orm-tables'
import type { AppAuthBackend } from '../../../shared/utils/auth-environment'
import type {
  EmailOtpType,
  GoTrueClient,
  Session as SupabaseSession,
  User as SupabaseUser,
} from '@supabase/auth-js'

export type AppAuthProvider = 'apple' | 'email'
type OAuthProvider = 'apple'
export type AppAuthenticatorAssuranceLevel = 'aal1' | 'aal2'

export interface AppSessionUser {
  aal?: AppAuthenticatorAssuranceLevel | null
  authBackend?: AppAuthBackend
  authProvider?: string | null
  authProviders?: string[]
  authSessionId?: string | null
  authSessionValidatedAt?: string | null
  email: string
  emailConfirmedAt?: string | null
  id: string
  isAdmin: boolean | null
  name: string | null
  needsPasswordSetup?: boolean
  recoveryMode?: boolean
}

export interface AuthMutationResult {
  message?: string
  nextStep?: 'signed_in' | 'email_confirmation' | 'password_recovery_sent'
  redirectTo?: string
  user: AppSessionUser | null
}

export interface MfaEnrollmentResult {
  factorId: string
  qrCodeDataUrl: string
  qrCodeSvg: string
  secret: string
  uri: string
}

export interface AuthConfig {
  anonKey: string
  appUrl: string
  authorityUrl: string
  authUrl: string
  backend: AppAuthBackend
  callbackPath: string
  confirmPath: string
  loginPath: string
  logoutPath: string
  providers: AppAuthProvider[]
  publicSignup: boolean
  redirectPath: string
  registerPath: string
  requireMfa: boolean
  resetPath: string
  serviceRoleKey: string
  storageKey: string
}

export interface CookieLikeStorage {
  getItem(key: string): string | null
  isServer: true
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export type ExchangeCodeOptions = {
  next?: string | null
} & (
  | {
      code: string
      tokenHash?: never
      verificationType?: never
    }
  | {
      code?: never
      tokenHash: string
      verificationType: EmailOtpType
    }
)

export interface RegisterInput {
  captchaToken?: string
  email: string
  name: string
  next?: string | null
  password: string
}

export interface LoginInput {
  captchaToken?: string
  email: string
  password: string
}

export interface PasswordResetRequest {
  captchaToken?: string
  email: string
}

export interface UpdateProfileInput {
  name?: string
}

export interface ChangePasswordInput {
  currentPassword?: string
  newPassword: string
}

export interface OAuthStartInput {
  next?: string | null
  provider: OAuthProvider
}

export interface NativeAppleSignInInput {
  identityToken: string
  nonce?: string
}

export interface VerifyMfaInput {
  code: string
  factorId: string
}

export interface PersistedSupabaseSession {
  aal: AppAuthenticatorAssuranceLevel | null
  authProvider: string | null
  authSessionId: string
  emailConfirmedAt: string | null
  needsPasswordSetup: boolean
  providers: string[]
  recoveryMode: boolean
}

export interface AppSupabaseContext {
  authSessionId: string
  authUser: SupabaseUser
  client: GoTrueClient
  localUser: LocalUser
  session: SupabaseSession
  sessionUser: AppSessionUser
}
