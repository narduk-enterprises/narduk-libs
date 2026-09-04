// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePosthog } from '../app/composables/usePosthog'

import { __setFixtureNuxtApp } from './fixtures/nuxt-imports'

afterEach(() => {
  __setFixtureNuxtApp({})
})

describe('usePosthog', () => {
  it('no-ops every method when PostHog has not initialized', () => {
    const { client, capture, identify, reset } = usePosthog()

    expect(client).toBeNull()
    expect(() => capture('test_event')).not.toThrow()
    expect(() => identify('user-1')).not.toThrow()
    expect(() => reset()).not.toThrow()
  })

  it('forwards to the initialized PostHog client on the enabled path', () => {
    const posthogClient = {
      capture: vi.fn(),
      identify: vi.fn(),
      reset: vi.fn(),
    }
    __setFixtureNuxtApp({ $posthog: posthogClient })

    const { client, capture, identify, reset } = usePosthog()

    expect(client).toBe(posthogClient)

    capture('page_viewed', { path: '/pricing' })
    identify('user-42', { plan: 'pro' })
    reset()

    expect(posthogClient.capture).toHaveBeenCalledWith('page_viewed', { path: '/pricing' })
    expect(posthogClient.identify).toHaveBeenCalledWith('user-42', { plan: 'pro' })
    expect(posthogClient.reset).toHaveBeenCalledTimes(1)
  })
})
