import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { __setFixtureNuxtApp } from './fixtures/nuxt-imports'

function noop() {}

// narduk-libs#1310 must keep holding when the schemas load lazily (#1527): the
// no-eval CSP probe is skipped because `jitless` is set while the shared schemas
// and the app's factory-built schemas are constructed, even though the loading
// now happens on the first capture() rather than at startup. This file owns its
// module graph, so Zod's first object schema is built under the stubbed
// `Function`, as in a browser chunk.

const functionCalls: string[] = []
const OriginalFunction = globalThis.Function

describe('lazy analytics validation under a no-eval CSP', () => {
  beforeAll(() => {
    globalThis.Function = new Proxy(OriginalFunction, {
      apply(_target, _this, args) {
        functionCalls.push(String(args.at(-1) ?? ''))
        throw new EvalError('Refused to evaluate a string as JavaScript (CSP stub)')
      },
      construct(_target, args) {
        functionCalls.push(String(args.at(-1) ?? ''))
        throw new EvalError('Refused to evaluate a string as JavaScript (CSP stub)')
      },
    })
  })
  afterAll(() => {
    globalThis.Function = OriginalFunction
  })

  it('never calls Function while loading, building or validating through capture()', async () => {
    const { useAnalytics } = await import('../app/composables/useAnalytics')
    const { createAnalyticsTransport } = await import('../app/utils/analyticsTransport')
    const { defineAnalyticsEvents } = await import('../app/lib/analyticsCatalog')
    const { standardAnalyticsEventsLoaded } = await import('../app/lib/analyticsValidation')
    expect(functionCalls).toEqual([])
    expect(standardAnalyticsEventsLoaded()).toBe(false)

    const sent: string[] = []
    const transport = createAnalyticsTransport({ enabled: true, context: () => ({}) })
    transport.attach({
      capture: (event: string) => void sent.push(event),
      identify: noop,
      reset: noop,
      register: noop,
      has_opted_out_capturing: () => false,
    } as never)
    __setFixtureNuxtApp({ $analytics: transport })

    const api = useAnalytics(async () => {
      const { z } = await import('zod')
      return defineAnalyticsEvents(() => ({
        primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
      }))
    })
    expect(api.capture('form_submitted', { form_id: 'signup' })).toBe(true)
    expect(api.capture('primary_action_completed', { source: 'map' })).toBe(true)
    expect(api.capture('form_submitted', { form_id: 'bad id' })).toBe(true)
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 5000 })

    expect(sent).toEqual(['form_submitted', 'primary_action_completed'])
    expect(api.capture('form_submitted', { form_id: 'bad id' })).toBe(false)
    expect(functionCalls).toEqual([])
  })

  it('shares one jitless setting with the installed Zod, and restores it', async () => {
    const { z } = await import('zod')
    const { withJitlessSchemas } = await import('../app/lib/analyticsCatalog')
    const zodGlobal = globalThis as typeof globalThis & { __zod_globalConfig?: unknown }
    expect(zodGlobal.__zod_globalConfig).toBe(z.config())

    const before = z.config().jitless
    withJitlessSchemas(() => expect(z.config().jitless).toBe(true))
    expect(z.config().jitless).toBe(before)
    expect(() =>
      withJitlessSchemas(() => {
        throw new Error('build failed')
      }),
    ).toThrow('build failed')
    expect(z.config().jitless).toBe(before)
  })
})
