/*
 * Server-render proof for the Auth* cards, mirroring narduk-charts's
 * `src/ssr.test.ts` (narduk-libs#269). The first paint of `/login`,
 * `/register`, `/auth/callback` and the settings panels happens on a
 * Nuxt/Nitro server — for the Cloudflare Workers preset, a runtime with no
 * `window` or `document`. This file runs in vitest's default `node`
 * environment and renders each registered Auth* card through
 * `@vue/server-renderer`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AuthApiKeysPanel from '../app/components/auth/AuthApiKeysPanel.vue'
import AuthExchangePanel from '../app/components/auth/AuthExchangePanel.vue'
import AuthLoginCard from '../app/components/auth/AuthLoginCard.vue'
import AuthPasskeysPanel from '../app/components/auth/AuthPasskeysPanel.vue'
import AuthRegisterCard from '../app/components/auth/AuthRegisterCard.vue'

import { renderAuthCard } from './fixtures/auth-component-harness'
import { resetAuthTestState } from './fixtures/nuxt-auto-imports'

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => false,
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

vi.mock('../app/composables/useAuthApi', async () => {
  const { authApiMocks } = await import('./fixtures/nuxt-auto-imports')
  return { useAuthApi: () => authApiMocks }
})

beforeEach(() => {
  resetAuthTestState()
})

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('Auth* cards server rendering without a DOM', () => {
  it('AuthLoginCard renders the sign-in form instead of throwing', async () => {
    const html = await renderAuthCard(AuthLoginCard, { title: 'Welcome back' })
    expect(html).toContain('Welcome back')
    expect(html).toContain('Sign In')
    expect(html).toContain('auth-login-email')
    expect(html).toContain('auth-login-password')
  })

  it('AuthRegisterCard renders the signup form instead of throwing', async () => {
    const html = await renderAuthCard(AuthRegisterCard, { title: 'Create an account' })
    expect(html).toContain('Create an account')
    expect(html).toContain('Create Account')
    expect(html).toContain('auth-register-email')
  })

  it('AuthExchangePanel renders the loading callback state instead of exchanging', async () => {
    const html = await renderAuthCard(AuthExchangePanel, { title: 'Finishing sign-in' })
    expect(html).toContain('Finishing sign-in')
    expect(html).toContain('Creating your first-party session on this app')
    expect(html).not.toContain('Auth callback failed')
  })

  it('AuthPasskeysPanel renders the loading inventory instead of throwing', async () => {
    const html = await renderAuthCard(AuthPasskeysPanel)
    expect(html).toContain('Passkeys')
    expect(html).toContain('Loading passkeys')
  })

  it('AuthApiKeysPanel renders the create surface instead of throwing', async () => {
    const html = await renderAuthCard(AuthApiKeysPanel, {
      tokenProfiles: [
        {
          description: 'Read-only registry access.',
          expiresInDays: 30,
          id: 'registry-read',
          label: 'Registry reader',
          scopes: ['registry:read'],
        },
      ],
    })
    expect(html).toContain('Personal API access')
    expect(html).toContain('Manage issued access')
    expect(html).toContain('Registry reader')
    expect(html).toContain('Loading tokens')
  })

  it('does not touch a DOM global merely by importing the cards', async () => {
    await expect(renderAuthCard(AuthLoginCard)).resolves.toContain('Welcome back')
    expect(typeof document).toBe('undefined')
  })
})
