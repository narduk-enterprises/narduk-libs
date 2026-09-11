// @vitest-environment happy-dom
/**
 * Mount coverage for the Auth* cards registered by narduk-auth
 * (`addComponentsDir` on `app/components`, narduk-libs#269). The cards
 * previously had only source-regex guardrails (`auth-card-autocomplete`,
 * `auth-login-card-contrast`). Those stay; this file mounts each SFC.
 *
 * Nuxt UI, `useAuth`, runtime config and `nuxt-auth-utils` are stubbed the
 * same way the package's server tests stub `#layer/*` — a fixture, not a
 * Nuxt app. Never call the network.
 */
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AuthApiKeysPanel from '../app/components/auth/AuthApiKeysPanel.vue'
import AuthExchangePanel from '../app/components/auth/AuthExchangePanel.vue'
import AuthLoginCard from '../app/components/auth/AuthLoginCard.vue'
import AuthPasskeysPanel from '../app/components/auth/AuthPasskeysPanel.vue'
import AuthRegisterCard from '../app/components/auth/AuthRegisterCard.vue'

import { mountAuthCard } from './fixtures/auth-component-harness'
import {
  authApiMocks,
  authMocks,
  navigateToMock,
  resetAuthTestState,
  routeQuery,
  runtimeConfig,
} from './fixtures/nuxt-auto-imports'

const ADA_EMAIL = 'ada@example.test'
const ADA_USER = { email: ADA_EMAIL, id: 'u1', name: 'Ada' }
const DASHBOARD_PATH = '/dashboard/'

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => false,
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

vi.mock('../app/composables/useAuthApi', async () => {
  const { authApiMocks: api } = await import('./fixtures/nuxt-auto-imports')
  return { useAuthApi: () => api }
})

beforeEach(() => {
  resetAuthTestState()
})

describe('AuthLoginCard mount', () => {
  it('renders the default title and credential fields', () => {
    const wrapper = mountAuthCard(AuthLoginCard)
    expect(wrapper.text()).toContain('Welcome back')
    expect(wrapper.text()).toContain('Sign in with your email and password.')
    expect(wrapper.find('[data-testid="auth-login-email"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auth-login-password"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="auth-login-submit"]').text()).toContain('Sign In')
    expect(wrapper.text()).toContain('Sign up')
    wrapper.unmount()
  })

  it('honours title, subtitle and the closed-signup footer', () => {
    runtimeConfig.public.authPublicSignup = false
    const wrapper = mountAuthCard(AuthLoginCard, {
      props: { subtitle: 'Use your family account.', title: 'Operator sign-in' },
    })
    expect(wrapper.text()).toContain('Operator sign-in')
    expect(wrapper.text()).toContain('Use your family account.')
    expect(wrapper.text()).toContain('Need access? Contact an administrator for an invite.')
    expect(wrapper.text()).not.toContain('Sign up')
    wrapper.unmount()
  })

  it('emits success and navigates after a completed login', async () => {
    authMocks.login.mockResolvedValue({ user: ADA_USER })
    const wrapper = mountAuthCard(AuthLoginCard)

    await wrapper.get('[data-testid="auth-login-email"]').setValue(ADA_EMAIL)
    await wrapper.get('[data-testid="auth-login-password"]').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(authMocks.login).toHaveBeenCalledWith({
      email: ADA_EMAIL,
      password: 'secret',
    })
    expect(wrapper.emitted('success')?.[0]).toEqual([ADA_USER])
    expect(navigateToMock).toHaveBeenCalledWith(DASHBOARD_PATH, { replace: true })
    wrapper.unmount()
  })

  it('surfaces a failed login without emitting success', async () => {
    authMocks.login.mockRejectedValue(new Error('Invalid email or password.'))
    const wrapper = mountAuthCard(AuthLoginCard)
    await wrapper.get('[data-testid="auth-login-email"]').setValue(ADA_EMAIL)
    await wrapper.get('[data-testid="auth-login-password"]').setValue('nope')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="auth-login-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Invalid email or password.')
    expect(wrapper.emitted('success')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('AuthRegisterCard mount', () => {
  it('renders the default title and fields', () => {
    const wrapper = mountAuthCard(AuthRegisterCard)
    expect(wrapper.text()).toContain('Create an account')
    expect(wrapper.find('[data-testid="auth-register-name"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auth-register-email"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auth-register-password"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="auth-register-submit"]').text()).toContain('Create Account')
    wrapper.unmount()
  })

  it('emits success after a completed registration', async () => {
    authMocks.register.mockResolvedValue({ user: ADA_USER })
    const wrapper = mountAuthCard(AuthRegisterCard, { props: { title: 'Join' } })
    expect(wrapper.text()).toContain('Join')

    await wrapper.get('[data-testid="auth-register-name"]').setValue(ADA_USER.name)
    await wrapper.get('[data-testid="auth-register-email"]').setValue(ADA_EMAIL)
    await wrapper.get('[data-testid="auth-register-password"]').setValue('password1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(authMocks.register).toHaveBeenCalledWith({
      email: ADA_EMAIL,
      name: ADA_USER.name,
      next: DASHBOARD_PATH,
      password: 'password1',
    })
    expect(wrapper.emitted('success')?.[0]).toEqual([ADA_USER])
    wrapper.unmount()
  })
})

describe('AuthExchangePanel mount', () => {
  it('renders the finishing-sign-in copy, then errors when the callback has no code', async () => {
    const wrapper = mountAuthCard(AuthExchangePanel)
    expect(wrapper.text()).toContain('Finishing sign-in')
    expect(wrapper.text()).toContain('validating the auth callback')
    await flushPromises()
    expect(wrapper.text()).toContain('The auth callback is missing its code.')
    expect(wrapper.text()).toContain('Back to sign in')
    wrapper.unmount()
  })

  it('exchanges a callback code and navigates', async () => {
    routeQuery.value = { code: 'pkce-code' }
    authMocks.exchangeSession.mockResolvedValue({ redirectTo: '/app' })
    const wrapper = mountAuthCard(AuthExchangePanel, {
      props: { title: 'Confirming your email' },
    })
    expect(wrapper.text()).toContain('Confirming your email')
    await flushPromises()
    expect(authMocks.exchangeSession).toHaveBeenCalledWith({
      code: 'pkce-code',
      next: undefined,
    })
    expect(navigateToMock).toHaveBeenCalledWith('/app', { replace: true })
    wrapper.unmount()
  })
})

describe('AuthPasskeysPanel mount', () => {
  it('renders the empty list after the API returns', async () => {
    const wrapper = mountAuthCard(AuthPasskeysPanel)
    expect(wrapper.text()).toContain('Passkeys')
    expect(wrapper.text()).toContain('Loading passkeys')
    await flushPromises()
    expect(authApiMocks.listPasskeys).toHaveBeenCalled()
    expect(wrapper.text()).toContain('No passkeys yet.')
    expect(wrapper.text()).toContain('Passkeys are not enabled for this app')
    wrapper.unmount()
  })

  it('lists enrolled passkeys', async () => {
    authApiMocks.listPasskeys.mockResolvedValue([
      {
        backedUp: true,
        createdAt: '2026-01-01',
        deviceType: 'multiDevice',
        id: 'pk1',
        lastUsedAt: null,
        name: 'MacBook',
        transports: ['internal'],
      },
    ])
    const wrapper = mountAuthCard(AuthPasskeysPanel)
    await flushPromises()
    expect(wrapper.get('[data-testid="auth-passkeys-list"]').text()).toContain('MacBook')
    expect(wrapper.text()).toContain('never used')
    wrapper.unmount()
  })
})

describe('AuthApiKeysPanel mount', () => {
  it('renders the create and inventory surfaces, then the empty inventory', async () => {
    const wrapper = mountAuthCard(AuthApiKeysPanel)
    expect(wrapper.text()).toContain('Personal API access')
    expect(wrapper.text()).toContain('Manage issued access')
    await flushPromises()
    expect(authApiMocks.listApiKeys).toHaveBeenCalled()
    expect(wrapper.text()).toContain('No API tokens yet')
    wrapper.unmount()
  })

  it('honours tokenProfiles and lists issued tokens', async () => {
    authApiMocks.listApiKeys.mockResolvedValue([
      {
        createdAt: '2026-01-02T00:00:00.000Z',
        expiresAt: null,
        id: 'k1',
        keyPrefix: 'nk_ab',
        lastUsedAt: null,
        name: 'CI token',
        scopes: ['auth:api-keys:read'],
      },
    ])
    const wrapper = mountAuthCard(AuthApiKeysPanel, {
      props: {
        tokenProfiles: [
          {
            description: 'Read-only registry access.',
            expiresInDays: 30,
            id: 'registry-read',
            label: 'Registry reader',
            scopes: ['registry:read'],
          },
        ],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Registry reader')
    expect(wrapper.text()).toContain('CI token')
    expect(wrapper.text()).toContain('nk_ab')
    wrapper.unmount()
  })
})
