/* eslint-disable narduk/file-size-budget -- Auth API composable groups all user-facing endpoints (login, register, logout, session, reset, confirm, MFA) that share types and error-mapping helpers; splitting would duplicate the type surface and make request parity harder to reason about. */
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

type EmailVerificationType =
  'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

type LegacyAuthMutationResult = AuthMutationResult

export function useAuthApi() {
  const maybeUseNuxtApp = (globalThis as { useNuxtApp?: () => { $csrfFetch?: typeof $fetch } })
    .useNuxtApp
  const nuxtApp = maybeUseNuxtApp?.() ?? {}
  const csrfFetch = (nuxtApp.$csrfFetch ?? $fetch) as typeof $fetch
  const csrfHeaders = { 'X-Requested-With': 'XMLHttpRequest' } as const

  function login(payload: { captchaToken?: string; email: string; password: string }) {
    return csrfFetch<LegacyAuthMutationResult>('/api/auth/login', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function register(payload: {
    captchaToken?: string
    email: string
    name: string
    next?: string
    password: string
  }) {
    return csrfFetch<LegacyAuthMutationResult>('/api/auth/register', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function logout() {
    return csrfFetch<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
      headers: csrfHeaders,
    })
  }

  function loginAsTestUser() {
    return csrfFetch<LegacyAuthMutationResult>('/api/auth/login-test', {
      method: 'POST',
      headers: csrfHeaders,
    })
  }

  function startOAuth(payload: { next?: string; provider: 'apple' }) {
    return csrfFetch<{ url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function exchangeSession(
    payload:
      | { code: string; next?: string }
      | { next?: string; tokenHash: string; verificationType: EmailVerificationType },
  ) {
    return csrfFetch<AuthMutationResult>('/api/auth/session/exchange', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function updateProfile(payload: { name?: string }) {
    return csrfFetch<{ ok: boolean; user: AuthUser }>('/api/auth/me', {
      method: 'PATCH',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function changePassword(payload: { currentPassword?: string; newPassword: string }) {
    return csrfFetch<{ success: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function deleteAccount(payload: { currentPassword?: string }) {
    return csrfFetch<{ success: boolean }>('/api/auth/account/delete', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function listApiKeys() {
    return csrfFetch<AuthApiKeySummary[]>('/api/auth/api-keys')
  }

  function createApiKey(payload: AuthApiKeyCreateInput) {
    return csrfFetch<AuthApiKeyCreateResponse>('/api/auth/api-keys', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function revokeApiKey(id: string) {
    return csrfFetch<{ success: boolean }>(`/api/auth/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: csrfHeaders,
    })
  }

  function requestPasswordReset(payload: { captchaToken?: string; email: string }) {
    return csrfFetch<AuthMutationResult>('/api/auth/password/reset', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function enrollMfa(payload: { friendlyName?: string }) {
    return csrfFetch<MfaEnrollmentResult>('/api/auth/mfa/enroll', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function verifyMfa(payload: { code: string; factorId: string }) {
    return csrfFetch<{ aal: 'aal1' | 'aal2'; success: boolean }>('/api/auth/mfa/verify', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  return {
    login,
    register,
    logout,
    loginAsTestUser,
    startOAuth,
    exchangeSession,
    updateProfile,
    changePassword,
    deleteAccount,
    listApiKeys,
    createApiKey,
    revokeApiKey,
    requestPasswordReset,
    enrollMfa,
    verifyMfa,
  }
}
