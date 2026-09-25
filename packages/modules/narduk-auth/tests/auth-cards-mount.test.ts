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
  authRuntimeData,
  navigateToMock,
  resetAuthTestState,
  routeQuery,
  runtimeConfig,
  toastAddMock,
} from './fixtures/nuxt-auto-imports'

const ADA_EMAIL = 'ada@example.test'
const ADA_USER = { email: ADA_EMAIL, id: 'u1', name: 'Ada' }
const DASHBOARD_PATH = '/dashboard/'

// A controllable mock (not the hardcoded `() => false` this replaced): the
// passkeys register/revoke tests below need `browserSupportsWebAuthn` to
// report true so `AuthPasskeysPanel`'s `canRegister` gate opens.
const webauthnMock = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => false),
}))

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: webauthnMock.browserSupportsWebAuthn,
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

vi.mock('../app/composables/useAuthApi', async () => {
  const { authApiMocks: api } = await import('./fixtures/nuxt-auto-imports')
  return { useAuthApi: () => api }
})

beforeEach(() => {
  resetAuthTestState()
  webauthnMock.browserSupportsWebAuthn.mockReturnValue(false)
})

describe('Sign in with Apple affordance (narduk-libs#164)', () => {
  it('shows Continue with Apple on the local backend when the server reports appleEnabled', async () => {
    authRuntimeData.value = {
      appleEnabled: true,
      authBackend: 'local',
      authProviders: ['email', 'apple'],
      passkeysEnabled: false,
    }
    authMocks.startOAuth.mockResolvedValue({ url: '/api/auth/apple/start?next=%2Fdashboard%2F' })
    const wrapper = mountAuthCard(AuthLoginCard)
    const button = wrapper.findAll('button').find((node) => node.text() === 'Continue with Apple')
    expect(button).toBeDefined()
    await button!.trigger('click')
    await flushPromises()
    expect(authMocks.startOAuth).toHaveBeenCalledWith({ provider: 'apple', next: DASHBOARD_PATH })
    expect(navigateToMock).toHaveBeenCalledWith('/api/auth/apple/start?next=%2Fdashboard%2F', {
      external: true,
    })
    wrapper.unmount()
  })

  it('hides it when apple is advertised on local but not configured', () => {
    authRuntimeData.value = {
      appleEnabled: false,
      authBackend: 'local',
      authProviders: ['email', 'apple'],
      passkeysEnabled: false,
    }
    for (const card of [AuthLoginCard, AuthRegisterCard]) {
      const wrapper = mountAuthCard(card)
      expect(wrapper.text()).not.toContain('Continue with Apple')
      wrapper.unmount()
    }
  })

  it('keeps the Supabase rule when the runtime answer has no appleEnabled', () => {
    authRuntimeData.value = {
      authBackend: 'supabase',
      authProviders: ['email', 'apple'],
      passkeysEnabled: false,
    }
    const wrapper = mountAuthCard(AuthLoginCard)
    expect(wrapper.text()).toContain('Continue with Apple')
    wrapper.unmount()
  })
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

  it('surfaces a failed registration via toUserFacingError without emitting success', async () => {
    authMocks.register.mockRejectedValue(new Error('Email already registered.'))
    const wrapper = mountAuthCard(AuthRegisterCard)

    await wrapper.get('[data-testid="auth-register-name"]').setValue(ADA_USER.name)
    await wrapper.get('[data-testid="auth-register-email"]').setValue(ADA_EMAIL)
    await wrapper.get('[data-testid="auth-register-password"]').setValue('password1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="auth-register-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Email already registered.')
    expect(wrapper.emitted('success')).toBeUndefined()
    wrapper.unmount()
  })

  it('falls back to the generic message when the rejection carries no message', async () => {
    authMocks.register.mockRejectedValue('nope')
    const wrapper = mountAuthCard(AuthRegisterCard)

    await wrapper.get('[data-testid="auth-register-name"]').setValue(ADA_USER.name)
    await wrapper.get('[data-testid="auth-register-email"]').setValue(ADA_EMAIL)
    await wrapper.get('[data-testid="auth-register-password"]').setValue('password1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Unable to create the account.')
    expect(wrapper.emitted('success')).toBeUndefined()
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

  it('forwards PKCE ?type=recovery so the server can set recovery_mode', async () => {
    routeQuery.value = { code: 'pkce-code', type: 'recovery', next: '/reset-password' }
    authMocks.exchangeSession.mockResolvedValue({ redirectTo: '/reset-password?recovery=1' })
    const wrapper = mountAuthCard(AuthExchangePanel)
    await flushPromises()
    expect(authMocks.exchangeSession).toHaveBeenCalledWith({
      code: 'pkce-code',
      next: '/reset-password',
      redirectType: 'recovery',
    })
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

  describe('when the browser and server both support passkeys', () => {
    beforeEach(() => {
      webauthnMock.browserSupportsWebAuthn.mockReturnValue(true)
      authRuntimeData.value = {
        authBackend: 'local',
        authProviders: ['email'],
        passkeysEnabled: true,
      }
    })

    it('registers a new passkey, toasts, and refreshes the list', async () => {
      authMocks.registerPasskey.mockResolvedValue(undefined)
      authApiMocks.listPasskeys.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          backedUp: false,
          createdAt: '2026-02-01',
          deviceType: 'singleDevice',
          id: 'pk2',
          lastUsedAt: null,
          name: 'YubiKey',
          transports: ['usb'],
        },
      ])

      const wrapper = mountAuthCard(AuthPasskeysPanel)
      await flushPromises()

      await wrapper.get('input').setValue('YubiKey')
      await wrapper.get('[data-testid="auth-passkeys-add"]').trigger('click')
      await flushPromises()

      expect(authMocks.registerPasskey).toHaveBeenCalledWith({ name: 'YubiKey' })
      expect(toastAddMock).toHaveBeenCalledWith({ title: 'Passkey added', color: 'success' })
      expect(wrapper.get('[data-testid="auth-passkeys-list"]').text()).toContain('YubiKey')
      wrapper.unmount()
    })

    it('surfaces a failed registration via toUserFacingError', async () => {
      authMocks.registerPasskey.mockRejectedValue(new Error('Registration ceremony failed.'))
      const wrapper = mountAuthCard(AuthPasskeysPanel)
      await flushPromises()

      await wrapper.get('[data-testid="auth-passkeys-add"]').trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="auth-passkeys-error"]').text()).toContain(
        'Registration ceremony failed.',
      )
      wrapper.unmount()
    })

    it('leaves the error message untouched when the platform sheet is dismissed', async () => {
      const dismissed = new Error('dismissed')
      dismissed.name = 'NotAllowedError'
      authMocks.registerPasskey.mockRejectedValue(dismissed)
      const wrapper = mountAuthCard(AuthPasskeysPanel)
      await flushPromises()

      await wrapper.get('[data-testid="auth-passkeys-add"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="auth-passkeys-error"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('revokes a passkey, toasts, and refreshes the list', async () => {
      authApiMocks.listPasskeys
        .mockResolvedValueOnce([
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
        .mockResolvedValueOnce([])

      const wrapper = mountAuthCard(AuthPasskeysPanel)
      await flushPromises()
      expect(wrapper.text()).toContain('MacBook')

      await wrapper.get('[data-testid="auth-passkeys-list"] button').trigger('click')
      await flushPromises()

      expect(authApiMocks.revokePasskey).toHaveBeenCalledWith('pk1')
      expect(toastAddMock).toHaveBeenCalledWith({ title: 'Passkey removed', color: 'success' })
      expect(wrapper.text()).toContain('No passkeys yet.')
      wrapper.unmount()
    })

    it('surfaces a failed revoke via toUserFacingError', async () => {
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
      authApiMocks.revokePasskey.mockRejectedValue(new Error('Passkey already removed.'))

      const wrapper = mountAuthCard(AuthPasskeysPanel)
      await flushPromises()

      await wrapper.get('[data-testid="auth-passkeys-list"] button').trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="auth-passkeys-error"]').text()).toContain(
        'Passkey already removed.',
      )
      wrapper.unmount()
    })
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

  it('creates a token with the parsed form payload, shows the raw key once, and refreshes', async () => {
    authApiMocks.createApiKey.mockResolvedValue({
      id: 'k9',
      rawKey: 'nk_raw999',
      scopes: [],
      expiresAt: null,
    })
    const wrapper = mountAuthCard(AuthApiKeysPanel)
    await flushPromises()

    await wrapper.get('input').setValue('CI token')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    // The real UForm shape (`event.data`), not the raw DOM event a stub bug
    // would have passed through — `formSchema`'s defaults (`scopesText: ''`,
    // `expiryPreset: '30 days'`) must survive that parse.
    expect(authApiMocks.createApiKey).toHaveBeenCalledWith({
      name: 'CI token',
      scopes: [],
      expiresInDays: 30,
    })
    expect(toastAddMock).toHaveBeenCalledWith({
      title: 'API token created',
      description: 'Copy the raw token now. It will not be shown again.',
      color: 'success',
    })
    expect(wrapper.text()).toContain('Copy this token now')
    expect(wrapper.text()).toContain('nk_raw999')
    expect(authApiMocks.listApiKeys).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('warns that a wildcard token must expire and cannot use Never', async () => {
    authApiMocks.createApiKey.mockResolvedValue({
      id: 'k-star',
      rawKey: 'nk_star',
      scopes: ['*'],
      expiresAt: 1_700_000_000 + 30 * 86_400,
    })
    const wrapper = mountAuthCard(AuthApiKeysPanel)
    await flushPromises()

    await wrapper.get('input').setValue('Ops token')
    const offeredBefore = wrapper.findAll('[data-select-item]').map((item) => item.text())
    expect(offeredBefore).toContain('Never')
    await wrapper.get('[data-select-item="Never"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-select-value]').attributes('data-select-value')).toBe('Never')

    await wrapper.get('textarea').setValue('*')
    await flushPromises()

    const offeredAfter = wrapper.findAll('[data-select-item]').map((item) => item.text())
    expect(offeredAfter).toEqual(['7 days', '30 days', '90 days'])
    expect(offeredAfter).not.toContain('Never')
    expect(wrapper.get('[data-select-value]').attributes('data-select-value')).toBe('30 days')
    expect(wrapper.text()).toContain('Wildcard token')
    expect(wrapper.text()).toContain('capped at 90 days')
    expect(wrapper.text()).not.toContain('No expiry selected')

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(authApiMocks.createApiKey).toHaveBeenCalledWith({
      name: 'Ops token',
      scopes: ['*'],
      expiresInDays: 30,
    })
    wrapper.unmount()
  })

  it('surfaces a failed token creation without clearing the raw-key banner state', async () => {
    authApiMocks.createApiKey.mockRejectedValue(new Error('Scope not permitted.'))
    const wrapper = mountAuthCard(AuthApiKeysPanel)
    await flushPromises()

    await wrapper.get('input').setValue('CI token')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Token error')
    expect(wrapper.text()).toContain('Scope not permitted.')
    expect(wrapper.text()).not.toContain('Copy this token now')
    wrapper.unmount()
  })

  it('revokes a token via handleRevoke and removes it from the list', async () => {
    authApiMocks.listApiKeys.mockResolvedValueOnce([
      {
        createdAt: '2026-01-02T00:00:00.000Z',
        expiresAt: null,
        id: 'k1',
        keyPrefix: 'nk_ab',
        lastUsedAt: null,
        name: 'CI token',
        scopes: [],
      },
    ])
    const wrapper = mountAuthCard(AuthApiKeysPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('CI token')

    const revokeButton = wrapper.findAll('button').find((button) => button.text() === 'Revoke')
    expect(revokeButton).toBeDefined()
    await revokeButton?.trigger('click')
    await flushPromises()

    expect(authApiMocks.revokeApiKey).toHaveBeenCalledWith('k1')
    expect(toastAddMock).toHaveBeenCalledWith({ title: 'API token revoked', color: 'success' })
    expect(wrapper.text()).not.toContain('CI token')
    expect(wrapper.text()).toContain('No API tokens yet')
    wrapper.unmount()
  })

  it('surfaces a failed revoke without removing the token from the list', async () => {
    authApiMocks.listApiKeys.mockResolvedValue([
      {
        createdAt: '2026-01-02T00:00:00.000Z',
        expiresAt: null,
        id: 'k1',
        keyPrefix: 'nk_ab',
        lastUsedAt: null,
        name: 'CI token',
        scopes: [],
      },
    ])
    authApiMocks.revokeApiKey.mockRejectedValue(new Error('Token already revoked.'))
    const wrapper = mountAuthCard(AuthApiKeysPanel)
    await flushPromises()

    const revokeButton = wrapper.findAll('button').find((button) => button.text() === 'Revoke')
    await revokeButton?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Token already revoked.')
    expect(wrapper.text()).toContain('CI token')
    wrapper.unmount()
  })
})
