import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDeterministicDateTime } from '../runtime/shared/utils/formatDeterministicDate'

/**
 * narduk-libs#1380: `build-meta` and `build-info.client` must not construct an
 * `Intl.DateTimeFormat` while Nuxt runs plugin setup (the path to hydration).
 * The formatting happens after `app:mounted` and browser idle, or on the first
 * read of `window.__NARDUK_BUILD__.localBuildTime`, through one shared
 * formatter, and the head tags, console line and payload keep their shape.
 */
const BUILD_TIME = '2026-10-03T13:47:23.000Z'
const LOCAL = 'Oct 3, 2026, 1:47 PM UTC'
const META_PLUGIN = '../runtime/app/plugins/build-meta'
const INFO_PLUGIN = '../runtime/app/plugins/build-info.client'

interface Entry {
  meta: Array<{ content: string; name: string }>
}

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  heads: [] as unknown[],
}))

vi.mock('#imports', () => ({
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({ public: state.config }),
  useHead: (entry: unknown) => {
    state.heads.push(entry)
  },
}))

type Plugin = (nuxtApp: unknown) => void
type IdleCallback = () => void

let idleQueue: IdleCallback[]
let mountedHooks: Array<() => void>
let formatterConstructions: number
let warn: ReturnType<typeof vi.spyOn>
let buildWindow: Record<string, unknown> & { requestIdleCallback?: unknown }

const nuxtApp = () => ({
  vueApp: { runWithContext: (fn: () => void) => fn() },
  hooks: {
    hookOnce: (name: string, callback: () => void) => {
      if (name === 'app:mounted') mountedHooks.push(callback)
    },
  },
})

async function loadPlugin(path: string): Promise<Plugin> {
  return ((await import(path)) as { default: Plugin }).default
}

function runMountedAndIdle() {
  for (const hook of mountedHooks.splice(0)) hook()
  for (const callback of idleQueue.splice(0)) callback()
}

function metaNames(): string[] {
  return state.heads.flatMap((entry) => (entry as Entry).meta.map((tag) => tag.name))
}

beforeEach(() => {
  vi.resetModules()
  state.heads = []
  state.config = {
    appName: 'Demo',
    appVersion: '1.2.3',
    buildVersion: 'abc123def456',
    buildTime: BUILD_TIME,
  }
  idleQueue = []
  mountedHooks = []
  buildWindow = {
    requestIdleCallback: (callback: IdleCallback) => idleQueue.push(callback),
  }
  vi.stubGlobal('window', buildWindow)

  const RealDateTimeFormat = Intl.DateTimeFormat
  formatterConstructions = 0
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    this: unknown,
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ) {
    formatterConstructions += 1
    return new RealDateTimeFormat(...args)
  } as unknown as typeof Intl.DateTimeFormat)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('formatBuildTimeLocal', () => {
  it('matches formatDeterministicDateTime and builds its formatter once', async () => {
    const { formatBuildTimeLocal } = await import('../runtime/app/utils/formatBuildTimeLocal')
    expect(formatterConstructions).toBe(0)

    const expected = formatDeterministicDateTime(new Date(BUILD_TIME)).replace(' at ', ', ')
    formatterConstructions = 0
    expect(formatBuildTimeLocal(BUILD_TIME)).toBe(expected)
    expect(formatBuildTimeLocal(BUILD_TIME)).toBe(LOCAL)
    expect(formatBuildTimeLocal('2026-01-02T03:04:00Z')).toBe('Jan 2, 2026, 3:04 AM UTC')
    expect(formatterConstructions).toBe(1)
  })

  it('keeps its fallbacks', async () => {
    const { formatBuildTimeLocal } = await import('../runtime/app/utils/formatBuildTimeLocal')
    expect(formatBuildTimeLocal('')).toBe('')
    expect(formatBuildTimeLocal(undefined, 'unknown')).toBe('unknown')
    expect(formatBuildTimeLocal(null, null)).toBeNull()
    expect(formatBuildTimeLocal('not a date')).toBe('not a date')
    expect(formatterConstructions).toBe(0)
  })
})

describe('build-meta plugin', () => {
  it('registers the server markers in setup without constructing a formatter', async () => {
    const plugin = await loadPlugin(META_PLUGIN)
    plugin(nuxtApp())

    expect(formatterConstructions).toBe(0)
    expect(state.heads).toEqual([
      {
        meta: [
          { name: 'app-version', content: '1.2.3' },
          { name: 'build-version', content: 'abc123def456' },
          { name: 'build-time', content: BUILD_TIME },
        ],
      },
    ])
  })

  it('adds build-time-local after mount and idle, unchanged in shape', async () => {
    const plugin = await loadPlugin(META_PLUGIN)
    plugin(nuxtApp())

    for (const hook of mountedHooks.splice(0)) hook()
    expect(formatterConstructions).toBe(0)
    expect(idleQueue).toHaveLength(1)

    idleQueue.splice(0)[0]!()
    expect(formatterConstructions).toBe(1)
    expect(state.heads[1]).toEqual({ meta: [{ name: 'build-time-local', content: LOCAL }] })
  })

  it('falls back to a timeout where requestIdleCallback is missing', async () => {
    vi.useFakeTimers()
    delete buildWindow.requestIdleCallback
    const plugin = await loadPlugin(META_PLUGIN)
    plugin(nuxtApp())
    for (const hook of mountedHooks.splice(0)) hook()
    expect(metaNames()).not.toContain('build-time-local')

    vi.runAllTimers()
    vi.useRealTimers()
    expect(metaNames()).toContain('build-time-local')
  })

  it('adds no build-time-local tag when there is no build time', async () => {
    state.config = { ...state.config, buildTime: '' }
    const plugin = await loadPlugin(META_PLUGIN)
    plugin(nuxtApp())
    runMountedAndIdle()

    expect(metaNames()).toEqual(['app-version', 'build-version', 'build-time'])
  })
})

describe('build-info.client plugin', () => {
  it('publishes the payload and marker in setup without constructing a formatter', async () => {
    const plugin = await loadPlugin(INFO_PLUGIN)
    plugin(nuxtApp())

    expect(formatterConstructions).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    expect(buildWindow.__NARDUK_BUILD_LOGGED__).toBe(`1.2.3:abc123def456:${BUILD_TIME}`)
    expect(Object.keys(buildWindow.__NARDUK_BUILD__ as object).sort()).toEqual([
      'appName',
      'appVersion',
      'buildTime',
      'buildVersion',
      'localBuildTime',
    ])
    expect(formatterConstructions).toBe(0)
  })

  it('formats on the first read of the payload and serialises like before', async () => {
    const plugin = await loadPlugin(INFO_PLUGIN)
    plugin(nuxtApp())

    const payload = buildWindow.__NARDUK_BUILD__ as Record<string, string>
    expect(payload.localBuildTime).toBe(LOCAL)
    expect(payload.localBuildTime).toBe(LOCAL)
    expect(formatterConstructions).toBe(1)
    expect({ ...payload }).toEqual({
      appName: 'Demo',
      appVersion: '1.2.3',
      buildVersion: 'abc123def456',
      buildTime: BUILD_TIME,
      localBuildTime: LOCAL,
    })
    expect(JSON.parse(JSON.stringify(payload))).toEqual({ ...payload })
  })

  it('logs the same console line after mount and idle', async () => {
    const plugin = await loadPlugin(INFO_PLUGIN)
    plugin(nuxtApp())
    runMountedAndIdle()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(`[build] Demo v1.2.3 · abc123def456 · deployed ${LOCAL}`)
  })

  it('names the banner by appDisplayName and leaves the analytics appName alone (#1498)', async () => {
    state.config = { ...state.config, appName: 'LakeStat', appDisplayName: 'Lake Status' }
    const plugin = await loadPlugin(INFO_PLUGIN)
    plugin(nuxtApp())
    runMountedAndIdle()

    expect(warn).toHaveBeenCalledWith(
      `[build] Lake Status v1.2.3 · abc123def456 · deployed ${LOCAL}`,
    )
    expect((buildWindow.__NARDUK_BUILD__ as { appName: string }).appName).toBe('LakeStat')
  })

  it('falls back to appName when appDisplayName is empty (#1498)', async () => {
    state.config = { ...state.config, appDisplayName: '' }
    const plugin = await loadPlugin(INFO_PLUGIN)
    plugin(nuxtApp())
    runMountedAndIdle()

    expect(warn).toHaveBeenCalledWith(`[build] Demo v1.2.3 · abc123def456 · deployed ${LOCAL}`)
  })

  it('keeps the unknown fallbacks and does not log twice for one build', async () => {
    state.config = { appName: '', appVersion: '', buildVersion: '', buildTime: '' }
    const plugin = await loadPlugin(INFO_PLUGIN)
    plugin(nuxtApp())
    runMountedAndIdle()
    expect(warn).toHaveBeenCalledWith('[build] Unknown App vunknown · unknown · deployed unknown')

    plugin(nuxtApp())
    runMountedAndIdle()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('shares one formatter with build-meta', async () => {
    const info = await loadPlugin(INFO_PLUGIN)
    const meta = await loadPlugin(META_PLUGIN)
    info(nuxtApp())
    meta(nuxtApp())
    runMountedAndIdle()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(metaNames()).toContain('build-time-local')
    expect(formatterConstructions).toBe(1)
  })
})
