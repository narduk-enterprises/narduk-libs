import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

import { type AuthMutationResult, type AuthUser, useAuthApi } from './useAuthApi'

type EmailVerificationType =
  'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

export function useAuth() {
  const { loggedIn, user, fetch: fetchSession, clear } = useUserSession()
  const api = useAuthApi()

  const isAuthenticated = computed(() => loggedIn.value)
  const authUser = computed<AuthUser | null>(() => (user.value as AuthUser | null) ?? null)

  async function login(payload: { captchaToken?: string; email: string; password: string }) {
    const result = (await api.login(payload)) as AuthMutationResult
    if (result.user) {
      await fetchSession()
    }
    return result
  }

  async function register(payload: {
    captchaToken?: string
    email: string
    name: string
    next?: string
    password: string
  }) {
    const result = (await api.register(payload)) as AuthMutationResult
    if (result.nextStep === 'signed_in' && result.user) {
      await fetchSession()
    }
    return result
  }

  async function logout() {
    await api.logout()
    await clear()
    await fetchSession()
  }

  async function startOAuth(payload: { next?: string; provider: 'apple' }) {
    return api.startOAuth(payload)
  }

  async function exchangeSession(
    payload:
      | { code: string; next?: string; redirectType?: EmailVerificationType }
      | { next?: string; tokenHash: string; verificationType: EmailVerificationType },
  ) {
    const result = await api.exchangeSession(payload)
    if (result.user) {
      await fetchSession()
    }
    return result
  }

  async function updateProfile(payload: { name?: string }) {
    const result = await api.updateProfile(payload)
    await fetchSession()
    return result
  }

  async function changePassword(payload: { currentPassword?: string; newPassword: string }) {
    const result = await api.changePassword(payload)
    await fetchSession()
    return result
  }

  async function deleteAccount(payload: { currentPassword?: string }) {
    const result = await api.deleteAccount(payload)
    await clear()
    await fetchSession()
    return result
  }

  async function requestPasswordReset(payload: {
    captchaToken?: string
    email: string
    next?: string
  }) {
    return api.requestPasswordReset(payload)
  }

  async function completeLocalEmailPassword(payload: { newPassword: string; token: string }) {
    const result = await api.completeLocalEmailPassword(payload)
    if (result.user) {
      await fetchSession()
    }
    return result
  }

  /**
   * Passkey sign-in.
   *
   * Discoverable-credential only: the ceremony takes no email, so the browser
   * shows the platform's own account picker and the server never learns which
   * account was attempted unless the assertion verifies.
   */
  async function signInWithPasskey() {
    const optionsJSON = await api.passkeyAuthenticationOptions()
    const response = await startAuthentication({ optionsJSON })
    const result = await api.passkeyAuthenticationVerify({ response })
    await fetchSession()
    return result
  }

  /** Enrol a new passkey for the signed-in user. Requires an existing session. */
  async function registerPasskey(payload: { name?: string | null } = {}) {
    const optionsJSON = await api.passkeyRegistrationOptions()
    const response = await startRegistration({ optionsJSON })
    return api.passkeyRegistrationVerify({ name: payload.name ?? null, response })
  }

  async function enrollMfa(payload: { friendlyName?: string }) {
    return api.enrollMfa(payload)
  }

  async function verifyMfa(payload: { code: string; factorId: string }) {
    const result = await api.verifyMfa(payload)
    await fetchSession()
    return result
  }

  return {
    user: authUser,
    isAuthenticated,
    loggedIn: isAuthenticated,
    fetchUser: fetchSession,
    login,
    register,
    signup: register,
    logout,
    startOAuth,
    exchangeSession,
    updateProfile,
    changePassword,
    deleteAccount,
    requestPasswordReset,
    completeLocalEmailPassword,
    enrollMfa,
    verifyMfa,
    signInWithPasskey,
    registerPasskey,
    listPasskeys: api.listPasskeys,
    revokePasskey: api.revokePasskey,
  }
}
