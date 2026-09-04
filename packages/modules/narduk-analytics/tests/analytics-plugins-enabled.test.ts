// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

let runtimeConfigValue: Record<string, unknown> = {}

vi.mock('#imports', () => ({
  defineNuxtPlugin: <T>(definition: T): T => definition,
  nextTick: (callback?: () => unknown): Promise<unknown> =>
    callback ? Promise.resolve().then(callback) : Promise.resolve(),
  useHead: vi.fn(),
  useRouter: () => ({ afterEach: vi.fn() }),
  useRuntimeConfig: () => runtimeConfigValue,
}))

const posthogInit = vi.fn()
const posthogRegister = vi.fn()
const posthogCapture = vi.fn()

vi.mock('posthog-js', () => ({
  posthog: {
    init: posthogInit.mockImplementation(() => ({ capture: posthogCapture })),
    register: posthogRegister,
    capture: posthogCapture,
  },
}))

function setLocation(hostname: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname, href: `https://${hostname}/`, origin: `https://${hostname}` },
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.cookie = ''
  setLocation('example.com')
  runtimeConfigValue = {
    public: {
      analyticsLoadStrategy: 'off',
      previewSafeMode: true,
    },
  }
})

describe('posthog.client — enabled path', () => {
  it('does not initialize PostHog when disabled (key missing / preview-safe / off)', async () => {
    const plugin = (await import('../app/plugins/posthog.client')).default

    const result = plugin.setup?.({ provide: vi.fn() }) as { provide: { posthog: unknown } }

    expect(result.provide.posthog).toBeUndefined()
    expect(posthogInit).not.toHaveBeenCalled()
  })

  it('initializes PostHog and registers super properties on the enabled path', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        posthogPublicKey: 'phc_test_key',
        posthogHost: 'https://us.i.posthog.com',
        appName: 'test-app',
        appVersion: '1.2.3',
        deploymentTarget: 'production',
        posthogSessionReplayEnabled: true,
      },
    }

    const plugin = (await import('../app/plugins/posthog.client')).default
    const provide = vi.fn()

    plugin.setup?.({ provide })

    // initializePosthog() runs asynchronously (dynamic import + strategy scheduling).
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posthogInit).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ api_host: 'https://us.i.posthog.com' }),
    )
    expect(posthogRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        app: 'test-app',
        app_version: '1.2.3',
        environment: 'production',
        is_owner: false,
      }),
    )
    expect(provide).toHaveBeenCalledWith(
      'posthog',
      expect.objectContaining({ capture: expect.any(Function) }),
    )
  })

  it('tags workers.dev preview traffic as internal, non-production', async () => {
    setLocation('bfe918b0-my-app.narduk-enterprises.workers.dev')
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        posthogPublicKey: 'phc_test_key',
        posthogHost: 'https://us.i.posthog.com',
        appName: 'test-app',
        deploymentTarget: undefined,
      },
    }

    const plugin = (await import('../app/plugins/posthog.client')).default
    plugin.setup?.({ provide: vi.fn() })

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posthogRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        is_internal_user: true,
        environment: 'preview',
      }),
    )
  })
})

describe('gtag.client — enabled path', () => {
  beforeEach(() => {
    window.dataLayer = undefined
    document.head.innerHTML = ''
  })

  it('does not load gtag.js when the measurement id is missing', async () => {
    const plugin = (await import('../app/plugins/gtag.client')).default

    expect(() => plugin.setup?.()).not.toThrow()
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull()
  })

  it('injects the gtag.js script and configures the measurement id on the enabled path', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        gaMeasurementId: 'G-TESTID',
      },
    }

    const plugin = (await import('../app/plugins/gtag.client')).default
    plugin.setup?.()

    const script = document.head.querySelector('script[src*="googletagmanager"]')
    expect(script).not.toBeNull()
    expect(script?.getAttribute('src')).toContain('G-TESTID')
    expect(window.dataLayer?.length).toBeGreaterThan(0)
  })
})
