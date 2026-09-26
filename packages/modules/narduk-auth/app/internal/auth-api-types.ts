export interface AuthUser {
  [key: string]: unknown
  aal?: 'aal1' | 'aal2' | null
  authBackend?: 'local' | 'supabase'
  authProvider?: string | null
  authProviders?: string[]
  authSessionId?: string | null
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
  selfServeLink?: string
  user: AuthUser | null
}

export interface MfaEnrollmentResult {
  factorId: string
  qrCodeDataUrl: string
  qrCodeSvg: string
  secret: string
  uri: string
}

export interface AuthApiKeyScopeOption {
  description: string
  id: string
  label: string
}

export interface AuthApiKeyTokenProfile {
  description: string
  expiresInDays?: number | null
  id: string
  label: string
  name?: string
  scopes?: string[]
}

export interface AuthApiKeySummary {
  createdAt: string
  expiresAt: number | null
  id: string
  keyPrefix: string
  lastUsedAt: string | null
  name: string
  scopes: string[]
}

export interface AuthApiKeyCreateResponse extends AuthApiKeySummary {
  rawKey: string
}

export interface AuthApiKeyCreateInput {
  expiresInDays?: number | null
  name: string
  scopes?: string[]
}

export interface AuthPasskeySummary {
  backedUp: boolean
  createdAt: string
  deviceType: 'multiDevice' | 'singleDevice'
  id: string
  lastUsedAt: string | null
  name: string | null
  transports: string[]
}

export interface AuthRuntimePublic {
  /** Sign in with Apple would complete: advertised, and on local also configured. */
  appleEnabled?: boolean
  authBackend: 'local' | 'supabase'
  authProviders: string[]
  passkeysEnabled: boolean
}
