/* eslint-disable max-lines -- single typed transport for every /api/auth endpoint (session, MFA, API keys, passkeys); splitting it by feature would fragment one wire contract across files and make an endpoint drift silently. */
import type {
  AuthApiKeyCreateInput,
  AuthApiKeyCreateResponse,
  AuthApiKeySummary,
  AuthMutationResult,
  AuthPasskeySummary,
  AuthUser,
  MfaEnrollmentResult,
} from '../internal/auth-api-types'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

export type {
  AuthApiKeyCreateInput,
  AuthApiKeyCreateResponse,
  AuthApiKeyScopeOption,
  AuthApiKeySummary,
  AuthApiKeyTokenProfile,
  AuthMutationResult,
  AuthPasskeySummary,
  AuthRuntimePublic,
  AuthUser,
  MfaEnrollmentResult,
} from '../internal/auth-api-types'

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

  function logoutEverywhere() {
    return csrfFetch<{ success: boolean }>('/api/auth/logout-everywhere', {
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
      | { code: string; next?: string; redirectType?: EmailVerificationType }
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

  function requestPasswordReset(payload: { captchaToken?: string; email: string; next?: string }) {
    return csrfFetch<AuthMutationResult>('/api/auth/password/reset', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function completeLocalEmailPassword(payload: { newPassword: string; token: string }) {
    return csrfFetch<AuthMutationResult>('/api/auth/password/complete', {
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

  function passkeyRegistrationOptions() {
    return csrfFetch<PublicKeyCredentialCreationOptionsJSON>(
      '/api/auth/passkeys/registration/options',
      { method: 'POST', headers: csrfHeaders },
    )
  }

  function passkeyRegistrationVerify(payload: {
    name?: string | null
    response: RegistrationResponseJSON
  }) {
    return csrfFetch<AuthPasskeySummary>('/api/auth/passkeys/registration/verify', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function passkeyAuthenticationOptions() {
    return csrfFetch<PublicKeyCredentialRequestOptionsJSON>(
      '/api/auth/passkeys/authentication/options',
      { method: 'POST', headers: csrfHeaders },
    )
  }

  function passkeyAuthenticationVerify(payload: { response: AuthenticationResponseJSON }) {
    return csrfFetch<{ user: AuthUser }>('/api/auth/passkeys/authentication/verify', {
      method: 'POST',
      body: payload,
      headers: csrfHeaders,
    })
  }

  function listPasskeys() {
    return csrfFetch<AuthPasskeySummary[]>('/api/auth/passkeys')
  }

  function revokePasskey(id: string) {
    return csrfFetch<{ success: boolean }>(`/api/auth/passkeys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: csrfHeaders,
    })
  }

  return {
    login,
    register,
    logout,
    logoutEverywhere,
    startOAuth,
    exchangeSession,
    updateProfile,
    changePassword,
    deleteAccount,
    listApiKeys,
    createApiKey,
    revokeApiKey,
    requestPasswordReset,
    completeLocalEmailPassword,
    enrollMfa,
    verifyMfa,
    passkeyRegistrationOptions,
    passkeyRegistrationVerify,
    passkeyAuthenticationOptions,
    passkeyAuthenticationVerify,
    listPasskeys,
    revokePasskey,
  }
}
