import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// narduk-libs#1527. Zod must not load until the first capture() needs it. Each
// test imports the modules fresh (resetModules), because the loaded-state is
// module-level, exactly as it is in a browser tab.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appFile = (path: string) => resolve(root, 'app', path)

function noop() {}
/** Waits for the capture queue of the module instance most recently imported. */
const flush = async () =>
  (await import('../app/lib/analyticsValidation')).analyticsValidationSettled()

async function fresh() {
  vi.resetModules()
  const { createAnalyticsTransport } = await import('../app/utils/analyticsTransport')
  const { useAnalytics } = await import('../app/composables/useAnalytics')
  const validation = await import('../app/lib/analyticsValidation')
  const { defineAnalyticsEvents } = await import('../app/lib/analyticsCatalog')
  const { z } = await import('zod')
  const { __setFixtureNuxtApp } = await import('./fixtures/nuxt-imports')
  return {
    setApp: __setFixtureNuxtApp,
    createAnalyticsTransport,
    useAnalytics,
    validation,
    defineAnalyticsEvents,
    z,
  }
}

function readyTransport(
  create: Awaited<ReturnType<typeof fresh>>['createAnalyticsTransport'],
  enabled = true,
) {
  const sent: Array<{ event: string; properties: Record<string, unknown> }> = []
  const transport = create({ enabled, context: () => ({ route: '/map' }) })
  transport.attach({
    capture: (event: string, properties?: Record<string, unknown>) => {
      sent.push({ event, properties: properties ?? {} })
      return
    },
    identify: noop,
    reset: noop,
    register: noop,
    has_opted_out_capturing: () => false,
  } as never)
  return { transport, sent }
}

describe('the entry-reachable modules do not import Zod statically', () => {
  // Walks the static imports of everything a plugin or composable pulls into the
  // client entry chunk. Type-only imports and import() are not edges.
  const entries = [
    'composables/useAnalytics.ts',
    'plugins/analytics-events.client.ts',
    'utils/analyticsDirective.ts',
  ]

  function staticImports(file: string): string[] {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext)
    const specifiers: string[] = []
    for (const node of source.statements) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly)
        specifiers.push((node.moduleSpecifier as ts.StringLiteral).text)
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specifiers.push(node.moduleSpecifier.text)
    }
    return specifiers
  }

  it('reaches no module that imports zod, directly or through analyticsEvents', () => {
    const seen = new Set<string>()
    const stack = entries.map(appFile)
    while (stack.length > 0) {
      const file = stack.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      for (const specifier of staticImports(file)) {
        expect(specifier, file).not.toMatch(/^zod(\/|$)/u)
        expect(specifier, file).not.toMatch(/analyticsEvents$/u)
        if (specifier.startsWith('.')) stack.push(resolve(dirname(file), specifier + '.ts'))
      }
    }
    expect([...seen].map((file) => file.replace(root + '/', ''))).toEqual(
      expect.arrayContaining(['app/lib/analyticsCatalog.ts', 'app/lib/analyticsValidation.ts']),
    )
  })

  it('loads the shared schemas only through import()', () => {
    const code = readFileSync(appFile('lib/analyticsValidation.ts'), 'utf8')
    expect(code).toMatch(/import\('\.\.\/utils\/analyticsEvents'\)/u)
  })
})

describe('lazy shared validation', () => {
  it('declares exactly the shared event names the registry lists', async () => {
    const { STANDARD_ANALYTICS_EVENT_NAMES, standardAnalyticsEvents } =
      await import('../app/utils/analyticsEvents')
    expect([...STANDARD_ANALYTICS_EVENT_NAMES].toSorted()).toEqual(
      Object.keys(standardAnalyticsEvents).toSorted(),
    )
  })

  it('validates and sends events captured before the schemas load, in call order', async () => {
    const { createAnalyticsTransport, useAnalytics, validation, defineAnalyticsEvents, z, setApp } =
      await fresh()
    const { transport, sent } = readyTransport(createAnalyticsTransport)
    setApp({ $analytics: transport })
    const catalog = defineAnalyticsEvents({
      primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
    })
    const api = useAnalytics(catalog)
    expect(validation.standardAnalyticsEventsLoaded()).toBe(false)

    const accepted = [
      api.capture('form_submitted', { form_id: 'signup' }),
      // Invalid: extra key. Accepted for validation, dropped when the schema arrives.
      api.capture('form_succeeded', { form_id: 'signup', email: 'a@b.c' } as never),
      // The app schema is already in hand, but must not overtake the waiting events.
      api.capture('primary_action_completed', { source: 'map' }),
      api.capture('share_clicked', { action_id: 'share', channel: 'native' }),
    ]
    expect(accepted).toEqual([true, true, true, true])
    expect(sent).toEqual([])

    await flush()
    expect(validation.standardAnalyticsEventsLoaded()).toBe(true)
    expect(sent.map((entry) => entry.event)).toEqual([
      'form_submitted',
      'primary_action_completed',
      'share_clicked',
    ])
    expect(sent.map((entry) => entry.event)).not.toContain('form_succeeded')
    // Parsed data, plus the route captured at call time.
    expect(sent[0]!.properties).toMatchObject({ form_id: 'signup', route: '/map' })
  })

  it("keeps today's synchronous answers once the schemas are in memory", async () => {
    const { createAnalyticsTransport, useAnalytics, validation, setApp } = await fresh()
    const { transport, sent } = readyTransport(createAnalyticsTransport)
    setApp({ $analytics: transport })
    const api = useAnalytics()
    api.capture('form_submitted', { form_id: 'signup' })
    await flush()
    expect(validation.standardAnalyticsEventsLoaded()).toBe(true)
    sent.length = 0

    expect(api.capture('form_submitted', { form_id: 'again' })).toBe(true)
    expect(sent).toHaveLength(1)
    expect(api.capture('form_submitted', { form_id: 'Not Allowed' })).toBe(false)
    expect(api.capture('form_submitted', { form_id: 'ok', extra: 1 } as never)).toBe(false)
    // @ts-expect-error Unknown shared event name must not compile.
    expect(api.capture('unknown_event', {})).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('answers an unknown event synchronously, and never loads Zod for a disabled transport', async () => {
    const { createAnalyticsTransport, useAnalytics, validation, setApp } = await fresh()
    const { transport } = readyTransport(createAnalyticsTransport)
    setApp({ $analytics: transport })
    // @ts-expect-error Unknown event name must not compile.
    expect(useAnalytics().capture('unknown_event', {})).toBe(false)

    const disabled = createAnalyticsTransport({ enabled: false, context: () => ({}) })
    setApp({ $analytics: disabled })
    expect(useAnalytics().capture('form_submitted', { form_id: 'signup' })).toBe(false)

    setApp({})
    expect(useAnalytics().capture('form_submitted', { form_id: 'signup' })).toBe(false)
    await flush()
    expect(validation.standardAnalyticsEventsLoaded()).toBe(false)
  })

  it('drops unvalidated events when the schemas cannot load, then recovers', async () => {
    vi.resetModules()
    vi.doMock('../app/utils/analyticsEvents', () => {
      throw new Error('chunk fetch failed')
    })
    const sentWhileBroken: string[] = []
    try {
      const broken = await fresh()
      const a = readyTransport(broken.createAnalyticsTransport)
      broken.setApp({ $analytics: a.transport })
      expect(broken.useAnalytics().capture('form_submitted', { form_id: 'signup' })).toBe(true)
      await flush()
      sentWhileBroken.push(...a.sent.map((entry) => entry.event))
    } finally {
      vi.doUnmock('../app/utils/analyticsEvents')
    }
    expect(sentWhileBroken).toEqual([])

    const healthy = await fresh()
    const b = readyTransport(healthy.createAnalyticsTransport)
    healthy.setApp({ $analytics: b.transport })
    healthy.useAnalytics().capture('form_submitted', { form_id: 'signup' })
    await flush()
    expect(b.sent.map((entry) => entry.event)).toEqual(['form_submitted'])
  })
})

describe('lazy app catalog', () => {
  it('loads the app catalog on first capture and validates it like an eager one', async () => {
    const { createAnalyticsTransport, useAnalytics, defineAnalyticsEvents, z, setApp } =
      await fresh()
    const { transport, sent } = readyTransport(createAnalyticsTransport)
    setApp({ $analytics: transport })
    const loader = vi.fn(async () =>
      defineAnalyticsEvents(() => ({
        primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
      })),
    )
    const api = useAnalytics(loader)
    expect(loader).not.toHaveBeenCalled()

    expect(api.capture('primary_action_completed', { source: 'map' })).toBe(true)
    expect(api.capture('primary_action_completed', { source: 'private' } as never)).toBe(true)
    expect(api.capture('form_submitted', { form_id: 'signup' })).toBe(true)
    await flush()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(sent.map((entry) => entry.event)).toEqual(['primary_action_completed', 'form_submitted'])

    // Loaded now: synchronous answers again.
    expect(api.capture('primary_action_completed', { source: 'private' } as never)).toBe(false)
    expect(api.capture('primary_action_completed', { source: 'list' })).toBe(true)
    // @ts-expect-error Undeclared event names fail typecheck and return false at runtime.
    expect(api.capture('undeclared', {})).toBe(false)
  })

  it('does not call the loader for a disabled transport, and recovers from a failed load', async () => {
    const { createAnalyticsTransport, useAnalytics, defineAnalyticsEvents, z, setApp } =
      await fresh()
    const loader = vi.fn(async () => defineAnalyticsEvents({ a_event: z.object({}).strict() }))
    setApp({
      $analytics: createAnalyticsTransport({ enabled: false, context: () => ({}) }),
    })
    expect(useAnalytics(loader).capture('a_event', {})).toBe(false)
    expect(loader).not.toHaveBeenCalled()

    const { transport, sent } = readyTransport(createAnalyticsTransport)
    setApp({ $analytics: transport })
    let attempts = 0
    const flaky = async () => {
      if (++attempts === 1) throw new Error('offline')
      return defineAnalyticsEvents({ a_event: z.object({}).strict() })
    }
    const api = useAnalytics(flaky)
    expect(api.capture('a_event', {})).toBe(true)
    await flush()
    expect(sent).toEqual([])
    expect(api.capture('a_event', {})).toBe(true)
    await flush()
    expect(sent.map((entry) => entry.event)).toEqual(['a_event'])
  })
})

describe('v-track directive', () => {
  it('validates through the lazy schemas and drops an invalid annotation', async () => {
    vi.resetModules()
    const { createAnalyticsTransport } = await import('../app/utils/analyticsTransport')
    const { installAnalyticsDirective } = await import('../app/utils/analyticsDirective')
    const { transport, sent } = readyTransport(createAnalyticsTransport)
    let directive: { mounted: (el: unknown, binding: unknown) => void } | undefined
    installAnalyticsDirective(
      { directive: (_name: string, value: typeof directive) => (directive = value) } as never,
      transport,
    )
    const listeners: Array<() => void> = []
    const element = { addEventListener: (_: string, fn: () => void) => listeners.push(fn) }
    directive!.mounted(element, {
      value: { event: 'share_clicked', properties: { action_id: 'share', channel: 'native' } },
    })
    directive!.mounted(element, {
      value: { event: 'share_clicked', properties: { action_id: 'share', channel: 'bad' } },
    })
    for (const listener of listeners) listener()
    await flush()
    expect(sent.map((entry) => entry.event)).toEqual(['share_clicked'])
  })
})
