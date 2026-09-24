import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyRuntimePublicOverlay } from '../runtime/server/utils/runtime-public'

import type { H3Event } from 'h3'

/**
 * Nitro's `useRuntimeConfig`, reduced to the part this suite relies on: with
 * an event it returns a per-event deep clone cached on
 * `event.context.nitro.runtimeConfig`; without one it returns the deep-frozen
 * isolate-wide object.
 */
const nitro = vi.hoisted(() => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) deepFreeze(child)
      Object.freeze(value)
    }
    return value
  }
  const state = {
    inline: { public: {} } as Record<string, unknown>,
    shared: deepFreeze({ public: {} }) as Record<string, unknown>,
    setInline(config: Record<string, unknown>) {
      state.inline = config
      state.shared = deepFreeze(structuredClone(config))
    },
  }
  return state
})

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: (event?: { context: { nitro: { runtimeConfig?: unknown } } }) => {
    if (!event) return nitro.shared
    event.context.nitro.runtimeConfig ??= structuredClone(nitro.inline)
    return event.context.nitro.runtimeConfig
  },
}))

type RequestHook = (value: H3Event) => void

const CANONICAL_URL = 'https://app.example'

function event(env: Record<string, string> | null = {}, host = 'app.example', path = '/'): H3Event {
  return {
    node: { req: { headers: { host }, url: path, socket: {} } },
    path,
    context: { nitro: {}, ...(env ? { cloudflare: { env } } : {}) },
  } as unknown as H3Event
}

function publicConfig(value: H3Event): Record<string, unknown> {
  const context = value.context as {
    nitro: { runtimeConfig?: { public: Record<string, unknown> } }
  }
  return context.nitro.runtimeConfig?.public ?? {}
}

async function requestHook(): Promise<RequestHook> {
  const hooks = new Map<string, RequestHook>()
  const plugin = (await import('../runtime/server/plugins/00-runtime-public')).default as (nitro: {
    hooks: { hook: (name: string, handler: RequestHook) => void }
  }) => void
  plugin({
    hooks: {
      hook(name, handler) {
        hooks.set(name, handler)
      },
    },
  })
  const hook = hooks.get('request')
  if (!hook) throw new Error('00-runtime-public registered no request hook')
  return hook
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__env__')
})

describe('00-runtime-public Nitro plugin', () => {
  it('fills the SSR payload from Worker bindings over an empty build bake', async () => {
    nitro.setInline({
      public: { appUrl: CANONICAL_URL, gaMeasurementId: '', posthogPublicKey: '' },
    })
    const hook = await requestHook()
    const request = event({ GA_MEASUREMENT_ID: 'G-SSR', POSTHOG_PUBLIC_KEY: 'phc_ssr' })

    hook(request)

    expect(publicConfig(request)).toMatchObject({
      gaMeasurementId: 'G-SSR',
      posthogPublicKey: 'phc_ssr',
      analyticsLoadStrategy: 'idle',
    })
  })

  it('writes a per-request clone and never the shared runtime config', async () => {
    nitro.setInline({
      public: { appUrl: CANONICAL_URL, gaMeasurementId: '', posthogPublicKey: '' },
    })
    const hook = await requestHook()
    const env = { GA_MEASUREMENT_ID: 'G-LIVE', POSTHOG_PUBLIC_KEY: 'phc_live' }
    const canonical = event(env)
    const previewAlias = event(env, 'app.account.workers.dev')

    hook(canonical)
    hook(previewAlias)

    // One immutable version, two hosts in the same isolate: the preview alias
    // must not blank the canonical request, nor the canonical fill the alias.
    expect(publicConfig(canonical)).toMatchObject({ gaMeasurementId: 'G-LIVE' })
    expect(publicConfig(previewAlias)).toMatchObject({
      gaMeasurementId: '',
      posthogPublicKey: '',
      analyticsLoadStrategy: 'off',
      posthogSessionReplayEnabled: false,
    })
    expect(nitro.shared).toEqual({
      public: { appUrl: CANONICAL_URL, gaMeasurementId: '', posthogPublicKey: '' },
    })
  })

  it('leaves server-read keys (preview-safe mode, target, URLs, auth) at their build values', async () => {
    const baked = {
      appUrl: CANONICAL_URL,
      siteUrl: CANONICAL_URL,
      deploymentTarget: 'production',
      previewSafeMode: false,
      authBackend: 'local',
      authProviders: ['email', 'apple'],
      appBackendPreset: 'default',
      gaMeasurementId: 'G-BAKED',
    }
    nitro.setInline({ public: { ...baked } })
    const hook = await requestHook()
    const request = event(
      { SITE_URL: 'https://other.example', AUTH_PROVIDERS: 'email', GA_MEASUREMENT_ID: 'G-LIVE' },
      'app.account.workers.dev',
    )

    hook(request)

    // The 5xx sanitizer reads `previewSafeMode` from this same object; the
    // overlay would flip it to true on a workers.dev alias of production.
    expect(publicConfig(request)).toMatchObject({
      ...baked,
      gaMeasurementId: '',
      analyticsLoadStrategy: 'off',
    })
    expect(publicConfig(request)).not.toHaveProperty('supabasePublishableKey')
    expect(publicConfig(request)).not.toHaveProperty('authAuthorityUrl')
  })

  it('keeps a strict analytics app strict: the overlay never carries analyticsPrivacy', async () => {
    nitro.setInline({ public: { analyticsPrivacy: 'strict', posthogPublicKey: '' } })
    const hook = await requestHook()
    const request = event({ POSTHOG_PUBLIC_KEY: 'phc_live', ANALYTICS_PRIVACY: 'standard' })

    hook(request)

    expect(publicConfig(request)).toMatchObject({
      analyticsPrivacy: 'strict',
      posthogPublicKey: 'phc_live',
    })
  })

  it("reads the isolate's globalThis.__env__ when the event carries no Cloudflare env (#843)", async () => {
    nitro.setInline({ public: { gaMeasurementId: '' } })
    Reflect.set(globalThis, '__env__', { GA_MEASUREMENT_ID: 'G-ISOLATE' })
    const hook = await requestHook()
    const nested = event(null)

    hook(nested)

    expect(publicConfig(nested)).toMatchObject({ gaMeasurementId: 'G-ISOLATE' })
  })

  it.each(['/api/users', '/_nuxt/entry.js'])(
    'skips %s, which never renders a page',
    async (path) => {
      nitro.setInline({ public: { gaMeasurementId: '' } })
      const hook = await requestHook()
      const request = event({ GA_MEASUREMENT_ID: 'G-LIVE' }, 'app.example', path)

      hook(request)

      expect((request.context as { nitro: object }).nitro).not.toHaveProperty('runtimeConfig')
    },
  )

  it('still fills the error page render', async () => {
    nitro.setInline({ public: { gaMeasurementId: '' } })
    const hook = await requestHook()
    const request = event(
      { GA_MEASUREMENT_ID: 'G-LIVE' },
      'app.example',
      '/__nuxt_error?status=500',
    )

    hook(request)

    expect(publicConfig(request)).toMatchObject({ gaMeasurementId: 'G-LIVE' })
  })

  it('returns exactly the keys it wrote', () => {
    nitro.setInline({ public: {} })
    const applied = applyRuntimePublicOverlay(
      event({ GA_MEASUREMENT_ID: 'G-JSON', POSTHOG_PUBLIC_KEY: 'phc_json' }),
    )
    expect(applied.gaMeasurementId).toBe('G-JSON')
    expect(applied.posthogPublicKey).toBe('phc_json')
    expect(applied).not.toHaveProperty('previewSafeMode')
    expect(applied).not.toHaveProperty('appUrl')
  })
})
