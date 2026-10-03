import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readEmbeddedRuntimePublic,
  RUNTIME_PUBLIC_PAYLOAD_KEY,
  RUNTIME_PUBLIC_REFRESH_AFTER_MS,
} from '../runtime/shared/runtime-public-payload'

/**
 * narduk-libs#1368: the browser `runtime-public` plugin used to await
 * `GET /api/runtime/public` before Nuxt mounted. These tests drive the shipped
 * plugin through the loop Nuxt runs (`await` each plugin's setup in order,
 * then mount) with a `$fetch` that never resolves, and prove that
 *
 * - a live SSR response's embedded overlay is applied with no fetch and no wait,
 * - plugins that `dependsOn: ['runtime-public']` still read every key,
 * - HTML without a trustworthy embedded overlay keeps the awaited fetch.
 */

const nuxt = vi.hoisted(() => ({
  config: { public: {} as Record<string, unknown> },
  event: undefined as { context: Record<string, unknown> } | undefined,
}))

vi.mock('#imports', () => ({
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useRequestEvent: () => nuxt.event,
  useRuntimeConfig: () => nuxt.config,
}))

interface Plugin {
  name: string
  setup: (nuxtApp: { payload: Record<string, unknown> }) => unknown
}

const BAKED = {
  appName: 'App',
  deploymentTarget: 'production',
  previewSafeMode: false,
  authBackend: 'local',
  gaMeasurementId: '',
  posthogPublicKey: '',
}

/** What the Worker resolved for this request (a workers.dev alias of production). */
const OVERLAY = {
  ...BAKED,
  deploymentTarget: 'preview',
  previewSafeMode: true,
  authBackend: 'supabase',
  gaMeasurementId: 'G-LIVE',
  posthogPublicKey: 'phc_live',
}

async function clientPlugin(): Promise<Plugin> {
  return (await import('../runtime/app/plugins/00-runtime-public.client')).default as Plugin
}

async function serverPlugin(): Promise<Plugin> {
  return (await import('../runtime/app/plugins/00-runtime-public.server')).default as Plugin
}

function embedded(values: Record<string, unknown>, at = Date.now()) {
  return { [RUNTIME_PUBLIC_PAYLOAD_KEY]: { at, values } }
}

/**
 * Nuxt's `applyPlugins`: setups run in order and each is awaited, so a pending
 * setup holds back everything after it, including the mount. `seen` records
 * what a dependent plugin (analytics, gtag, PostHog) reads when it runs.
 */
async function bootNuxt(payload: Record<string, unknown>) {
  const events: string[] = []
  const seen: Record<string, unknown> = {}
  const dependent: Plugin = {
    name: 'analytics-like',
    setup() {
      events.push('dependent')
      Object.assign(seen, nuxt.config.public)
    },
  }
  const plugins = [await clientPlugin(), dependent]
  const booted = (async () => {
    for (const plugin of plugins) await plugin.setup({ payload })
    events.push('mounted')
  })()
  return { booted, events, seen }
}

/** Resolves true when `promise` settles first, false when `ms` of real time passes. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  nuxt.config = { public: { ...BAKED } }
  nuxt.event = undefined
  fetchMock = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('runtime-public client plugin: live SSR response', () => {
  it('mounts without waiting on a fetch that never resolves', async () => {
    const { booted, events } = await bootNuxt(embedded(OVERLAY))

    expect(await settlesWithin(booted, 50)).toBe(true)
    expect(events).toEqual(['dependent', 'mounted'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies every overlay key before the plugins that depend on it run', async () => {
    const { booted, seen } = await bootNuxt(embedded(OVERLAY))
    await booted

    // The keys SSR leaves at their build values (preview-safe mode, target,
    // auth) are exactly the ones the analytics plugins and auth cards read.
    expect(seen).toMatchObject({
      previewSafeMode: true,
      deploymentTarget: 'preview',
      authBackend: 'supabase',
      gaMeasurementId: 'G-LIVE',
      posthogPublicKey: 'phc_live',
    })
    expect(nuxt.config.public).toEqual(OVERLAY)
  })

  it('does not return a promise, so Nuxt has nothing to await', async () => {
    const plugin = await clientPlugin()

    const result = plugin.setup({ payload: embedded(OVERLAY) })

    expect(result).toBeUndefined()
  })

  it('refreshes embedded values older than a minute in the background and applies the reply', async () => {
    const stale = Date.now() - RUNTIME_PUBLIC_REFRESH_AFTER_MS - 1000
    let reply!: (value: Record<string, unknown>) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => (reply = resolve)))

    const { booted, seen } = await bootNuxt(embedded(OVERLAY, stale))

    // Cached HTML does not hold hydration either, and starts from its values.
    expect(await settlesWithin(booted, 50)).toBe(true)
    expect(seen.previewSafeMode).toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/runtime/public')

    reply({ ...OVERLAY, posthogPublicKey: 'phc_rotated' })
    await vi.waitFor(() => expect(nuxt.config.public.posthogPublicKey).toBe('phc_rotated'))
  })

  it('keeps the embedded values when the background refresh fails', async () => {
    const stale = Date.now() - RUNTIME_PUBLIC_REFRESH_AFTER_MS - 1000
    fetchMock.mockRejectedValue(new Error('offline'))

    const { booted } = await bootNuxt(embedded(OVERLAY, stale))
    await booted
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(nuxt.config.public).toEqual(OVERLAY)
  })
})

describe('runtime-public client plugin: no trustworthy embedded overlay', () => {
  it.each([
    ['carries no overlay (older server)', {}],
    ['was prerendered', { ...embedded(OVERLAY), prerenderedAt: Date.now() }],
    ['carries a malformed overlay', { [RUNTIME_PUBLIC_PAYLOAD_KEY]: { at: 1, values: 'nope' } }],
  ])('keeps the awaited fetch when the HTML %s', async (_label, payload) => {
    let reply!: (value: Record<string, unknown>) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => (reply = resolve)))

    const { booted, events, seen } = await bootNuxt(payload)

    // Nothing after the plugin runs, and nothing mounts, until the reply lands.
    expect(await settlesWithin(booted, 50)).toBe(false)
    expect(events).toEqual([])
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/runtime/public')

    reply(OVERLAY)
    await booted

    expect(events).toEqual(['dependent', 'mounted'])
    expect(seen).toMatchObject({ previewSafeMode: true, deploymentTarget: 'preview' })
    expect(nuxt.config.public).toEqual(OVERLAY)
  })

  it('mounts on the baked values when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const { booted, events } = await bootNuxt({})
    await booted

    expect(events).toEqual(['dependent', 'mounted'])
    expect(nuxt.config.public).toEqual(BAKED)
  })
})

describe('readEmbeddedRuntimePublic', () => {
  it('reads an overlay after a JSON round trip, as the payload is transported', () => {
    const wire = JSON.parse(JSON.stringify(embedded(OVERLAY, 1234))) as Record<string, unknown>

    expect(readEmbeddedRuntimePublic(wire)).toEqual({ at: 1234, values: OVERLAY })
  })

  it.each([
    ['no key', {}],
    ['a non-object', { [RUNTIME_PUBLIC_PAYLOAD_KEY]: 'x' }],
    ['an array', { [RUNTIME_PUBLIC_PAYLOAD_KEY]: [] }],
    ['no values', { [RUNTIME_PUBLIC_PAYLOAD_KEY]: { at: 1 } }],
    ['prerenderedAt', { ...embedded(OVERLAY), prerenderedAt: 1 }],
  ])('returns null for %s', (_label, payload) => {
    expect(readEmbeddedRuntimePublic(payload)).toBeNull()
  })

  it('treats a missing timestamp as infinitely old, so the overlay is refreshed', () => {
    const read = readEmbeddedRuntimePublic({ [RUNTIME_PUBLIC_PAYLOAD_KEY]: { values: OVERLAY } })

    expect(read?.at).toBe(0)
  })
})

describe('runtime-public payload server plugin', () => {
  it("embeds the request's overlay in the payload", async () => {
    nuxt.event = { context: { runtimePublicOverlay: OVERLAY } }
    const payload: Record<string, unknown> = {}
    vi.spyOn(Date, 'now').mockReturnValue(1_758_628_800_000)

    ;(await serverPlugin()).setup({ payload })

    expect(payload[RUNTIME_PUBLIC_PAYLOAD_KEY]).toEqual({ at: 1_758_628_800_000, values: OVERLAY })
    vi.restoreAllMocks()
  })

  it('writes nothing when the request produced no overlay', async () => {
    nuxt.event = { context: {} }
    const payload: Record<string, unknown> = {}

    ;(await serverPlugin()).setup({ payload })
    nuxt.event = undefined
    ;(await serverPlugin()).setup({ payload })

    expect(payload).toEqual({})
  })
})
