/**
 * Stand-in for Nuxt / narduk-auth auto-imports used by the Auth* cards.
 * `vitest.config.ts` injects these into the card SFCs and aliases
 * `#auth-test-imports` here, so the components mount and server-render
 * without a Nuxt build or `nuxt-auth-utils` (narduk-libs#269).
 */
import { vi } from 'vitest'
import { ref } from 'vue'

import type { AuthRuntimePublic } from '../../app/internal/auth-api-types'

export const runtimeConfig = {
  public: {
    authBackend: 'local',
    authProviders: ['email'] as string[],
    authPublicSignup: true,
    authRedirectPath: '/dashboard/',
    authRegisterPath: '/register',
    authResetPath: '/reset-password',
    authLoginPath: '/login',
  },
}

export const routeQuery = ref<Record<string, unknown>>({})

export const authRuntimeData = ref<AuthRuntimePublic | null>({
  authBackend: 'local',
  authProviders: ['email'],
  passkeysEnabled: false,
})

export const navigateToMock = vi.fn()
export const toastAddMock = vi.fn()

export const authMocks = {
  login: vi.fn(),
  register: vi.fn(),
  startOAuth: vi.fn(),
  signInWithPasskey: vi.fn(),
  exchangeSession: vi.fn(),
  registerPasskey: vi.fn(),
}

export const authApiMocks = {
  listPasskeys: vi.fn(),
  revokePasskey: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}

export function useRuntimeConfig() {
  return runtimeConfig
}

export function useRoute() {
  return { query: routeQuery.value }
}

export function navigateTo(...args: unknown[]) {
  return navigateToMock(...args)
}

export function useAuth() {
  return authMocks
}

export function useAuthRuntimePublic() {
  return { data: authRuntimeData }
}

export function useToast() {
  return { add: toastAddMock }
}

export function resetAuthTestState() {
  runtimeConfig.public.authBackend = 'local'
  runtimeConfig.public.authProviders = ['email']
  runtimeConfig.public.authPublicSignup = true
  runtimeConfig.public.authRedirectPath = '/dashboard/'
  runtimeConfig.public.authRegisterPath = '/register'
  runtimeConfig.public.authResetPath = '/reset-password'
  runtimeConfig.public.authLoginPath = '/login'
  routeQuery.value = {}
  authRuntimeData.value = {
    authBackend: 'local',
    authProviders: ['email'],
    passkeysEnabled: false,
  }
  navigateToMock.mockReset()
  toastAddMock.mockReset()
  for (const mock of Object.values(authMocks)) mock.mockReset()
  for (const mock of Object.values(authApiMocks)) mock.mockReset()
  authApiMocks.listPasskeys.mockResolvedValue([])
  authApiMocks.listApiKeys.mockResolvedValue([])
  authApiMocks.revokePasskey.mockResolvedValue({ success: true })
  authApiMocks.revokeApiKey.mockResolvedValue({ success: true })
}
