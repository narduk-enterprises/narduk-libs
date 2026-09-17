import { describe, expect, it, vi } from 'vitest'

import { applyRuntimePublicOverlay } from '../runtime/server/utils/runtime-public'

import type { H3Event } from 'h3'

const runtimeConfig = vi.hoisted(() => ({ current: { public: {} } as Record<string, unknown> }))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => runtimeConfig.current,
}))

function event(env: Record<string, string> = {}, host = 'app.example'): H3Event {
  return {
    node: { req: { headers: { host }, url: '/', socket: {} } },
    path: '/',
    context: { cloudflare: { env } },
  } as unknown as H3Event
}

describe('00-runtime-public Nitro plugin', () => {
  it('applies the Worker overlay on every request so SSR __NUXT__ is not an empty bake', async () => {
    runtimeConfig.current = {
      public: { gaMeasurementId: '', posthogPublicKey: '' },
    }
    const hooks = new Map<string, (value: H3Event) => void>()
    const plugin = (await import('../runtime/server/plugins/00-runtime-public')).default as (
      nitro: { hooks: { hook: (name: string, handler: (event: H3Event) => void) => void } },
    ) => void

    plugin({
      hooks: {
        hook(name, handler) {
          hooks.set(name, handler)
        },
      },
    })

    expect(hooks.has('request')).toBe(true)
    hooks.get('request')?.(
      event({
        GA_MEASUREMENT_ID: 'G-SSR',
        POSTHOG_PUBLIC_KEY: 'phc_ssr',
      }),
    )

    expect(runtimeConfig.current.public).toMatchObject({
      gaMeasurementId: 'G-SSR',
      posthogPublicKey: 'phc_ssr',
    })
  })

  it('shares applyRuntimePublicOverlay with the JSON route', () => {
    runtimeConfig.current = { public: { gaMeasurementId: '', posthogPublicKey: '' } }
    const overlay = applyRuntimePublicOverlay(
      event({ GA_MEASUREMENT_ID: 'G-JSON', POSTHOG_PUBLIC_KEY: 'phc_json' }),
    )
    expect(overlay.gaMeasurementId).toBe('G-JSON')
    expect(overlay.posthogPublicKey).toBe('phc_json')
  })
})
