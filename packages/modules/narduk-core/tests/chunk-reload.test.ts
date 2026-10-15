import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  type ChunkReloadStorage,
  claimChunkReload,
  isChunkLoadError,
  isChunkReloadEnabled,
  reloadForChunkError,
} from '../runtime/shared/chunk-reload'

// A variable specifier: the layer-tooling typecheck project stubs `#imports` and
// lists its files; the plugin is typechecked by Nuxt's own app project.
const PLUGIN = '../runtime/app/plugins/chunk-reload.client'

type Handler = (...args: never[]) => unknown

const state = vi.hoisted(() => {
  const captured: {
    afterEach?: Handler
    beforeEach?: Handler
    onError?: Handler
  } = {}
  return {
    appConfig: {} as Record<string, unknown>,
    captured,
    router: {
      beforeEach: vi.fn((handler: Handler) => {
        captured.beforeEach = handler
      }),
      afterEach: vi.fn((handler: Handler) => {
        captured.afterEach = handler
      }),
      onError: vi.fn((handler: Handler) => {
        captured.onError = handler
      }),
      resolve: vi.fn((path: string) => ({ href: `/base${path}` })),
    },
  }
})

vi.mock('#imports', () => ({
  defineNuxtPlugin: (plugin: unknown) => plugin,
  useAppConfig: () => state.appConfig,
  useRouter: () => state.router,
}))

/**
 * A tab that outlived a deploy asks for a hashed chunk that is gone. The
 * matcher decides what counts, the guard decides whether a reload may happen,
 * and the plugin wires both to the browser and the router.
 */

function memoryStorage(initial: Record<string, string> = {}): ChunkReloadStorage & {
  values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('isChunkLoadError', () => {
  it.each([
    ['Safari', 'Importing a module script failed.'],
    ['Chrome', 'Failed to fetch dynamically imported module: https://x.test/_nuxt/abc123.js'],
    ['Firefox', 'error loading dynamically imported module: https://x.test/_nuxt/abc123.js'],
    ['Vite CSS', 'Unable to preload CSS for /_nuxt/entry.abc.css'],
    ['webpack', 'Loading chunk 42 failed.'],
    ['webpack CSS', 'Loading CSS chunk app failed.'],
  ])('matches the %s message', (_browser, message) => {
    expect(isChunkLoadError(message)).toBe(true)
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
    expect(isChunkLoadError({ message })).toBe(true)
  })

  it('matches an error named ChunkLoadError whatever its message says', () => {
    const error = Object.assign(new Error('boom'), { name: 'ChunkLoadError' })
    expect(isChunkLoadError(error)).toBe(true)
  })

  it('is case-insensitive for the browser phrases', () => {
    expect(isChunkLoadError('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: /a.js')).toBe(true)
  })

  it.each([
    ['an unrelated error', new Error('Cannot read properties of undefined')],
    ['a network fetch failure', new TypeError('Failed to fetch')],
    ['a module mention', new Error('Cannot find module foo')],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 500],
    ['an object without a message', {}],
    ['a non-string message', { message: 42 }],
  ])('does not match %s', (_label, input) => {
    expect(isChunkLoadError(input)).toBe(false)
  })
})

describe('claimChunkReload', () => {
  it('allows the first reload and records its time', () => {
    const storage = memoryStorage()
    expect(claimChunkReload(storage, 1_000)).toBe(true)
    expect(storage.values.get(CHUNK_RELOAD_STORAGE_KEY)).toBe('1000')
  })

  it('refuses a second reload inside the window', () => {
    const storage = memoryStorage()
    expect(claimChunkReload(storage, 1_000)).toBe(true)
    expect(claimChunkReload(storage, 1_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false)
    // A refusal does not extend the window.
    expect(storage.values.get(CHUNK_RELOAD_STORAGE_KEY)).toBe('1000')
  })

  it('allows another reload once the window has passed', () => {
    const storage = memoryStorage()
    expect(claimChunkReload(storage, 1_000)).toBe(true)
    expect(claimChunkReload(storage, 1_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(true)
    expect(storage.values.get(CHUNK_RELOAD_STORAGE_KEY)).toBe(
      String(1_000 + CHUNK_RELOAD_WINDOW_MS),
    )
  })

  it('treats a stored time in the future or a garbage value as not recent', () => {
    expect(claimChunkReload(memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: '9999999' }), 1_000)).toBe(
      true,
    )
    expect(claimChunkReload(memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: 'nope' }), 1_000)).toBe(
      true,
    )
  })

  it('honours a custom window', () => {
    const storage = memoryStorage()
    expect(claimChunkReload(storage, 0, 50)).toBe(true)
    expect(claimChunkReload(storage, 49, 50)).toBe(false)
    expect(claimChunkReload(storage, 50, 50)).toBe(true)
  })

  it('fails closed with no storage', () => {
    expect(claimChunkReload(null, 1_000)).toBe(false)
    expect(claimChunkReload(undefined, 1_000)).toBe(false)
  })

  it('fails closed when storage throws on read or on write', () => {
    const unreadable: ChunkReloadStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
    }
    const unwritable: ChunkReloadStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(claimChunkReload(unreadable, 1_000)).toBe(false)
    expect(claimChunkReload(unwritable, 1_000)).toBe(false)
  })
})

describe('isChunkReloadEnabled', () => {
  it('is on by default and for any value but false', () => {
    expect(isChunkReloadEnabled(undefined)).toBe(true)
    expect(isChunkReloadEnabled({})).toBe(true)
    expect(isChunkReloadEnabled({ narduk: null })).toBe(true)
    expect(isChunkReloadEnabled({ narduk: {} })).toBe(true)
    expect(isChunkReloadEnabled({ narduk: { chunkReload: true } })).toBe(true)
    expect(isChunkReloadEnabled({ narduk: { chunkReload: 0 } })).toBe(true)
  })

  it('opts out only on an explicit false', () => {
    expect(isChunkReloadEnabled({ narduk: { chunkReload: false } })).toBe(false)
  })
})

describe('reloadForChunkError', () => {
  it('reloads once to the given url, then holds', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    let now = 5_000
    const env = { now: () => now, reload, storage }

    expect(reloadForChunkError(env, '/target')).toBe(true)
    expect(reload).toHaveBeenCalledExactlyOnceWith('/target')

    now += 1_000
    expect(reloadForChunkError(env, '/target')).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads without storage', () => {
    const reload = vi.fn()
    expect(reloadForChunkError({ now: () => 0, reload, storage: null }, '/x')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('chunk-reload plugin', () => {
  let listeners: Map<string, (event: { preventDefault(): void }) => void>
  let hooks: Map<string, Handler>
  let storage: ReturnType<typeof memoryStorage>
  let location: { assign: ReturnType<typeof vi.fn>; href: string; reload: ReturnType<typeof vi.fn> }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    state.appConfig = {}
    state.captured.afterEach = state.captured.beforeEach = state.captured.onError = undefined
    listeners = new Map()
    hooks = new Map()
    storage = memoryStorage()
    location = { href: 'https://app.test/current', reload: vi.fn(), assign: vi.fn() }
    vi.stubGlobal('window', {
      location,
      sessionStorage: storage,
      addEventListener: (name: string, listener: (event: { preventDefault(): void }) => void) => {
        listeners.set(name, listener)
      },
    })
    vi.stubGlobal('URL', URL)
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })

  async function install() {
    const plugin = (
      (await import(PLUGIN)) as {
        default: { setup(app: unknown): void }
      }
    ).default
    plugin.setup({
      hook: (name: string, handler: Handler) => {
        hooks.set(name, handler)
      },
    })
  }

  it('reloads to the page being opened when a preload fails, and suppresses the error', async () => {
    await install()
    ;(state.captured.beforeEach as (to: { fullPath: string }) => void)({ fullPath: '/next?a=1' })
    const preventDefault = vi.fn()
    listeners.get('vite:preloadError')?.({ preventDefault })

    expect(location.assign).toHaveBeenCalledExactlyOnceWith('/base/next?a=1')
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('reloads the current page when no navigation is pending', async () => {
    await install()
    ;(state.captured.beforeEach as (to: { fullPath: string }) => void)({ fullPath: '/next' })
    ;(state.captured.afterEach as () => void)()
    listeners.get('vite:preloadError')?.({ preventDefault: vi.fn() })

    expect(location.reload).toHaveBeenCalledTimes(1)
    expect(location.assign).not.toHaveBeenCalled()
  })

  it('lets a second failure inside the window through to the error page', async () => {
    await install()
    const first = vi.fn()
    const second = vi.fn()
    listeners.get('vite:preloadError')?.({ preventDefault: first })
    vi.setSystemTime(100_000 + CHUNK_RELOAD_WINDOW_MS - 1)
    listeners.get('vite:preloadError')?.({ preventDefault: second })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(location.reload).toHaveBeenCalledTimes(1)
  })

  it('reloads on Nuxt app:chunkError', async () => {
    await install()
    ;(hooks.get('app:chunkError') as () => void)()
    expect(location.reload).toHaveBeenCalledTimes(1)
  })

  it('reloads on a router error only when it is a chunk error, to that route', async () => {
    await install()
    const onError = state.captured.onError as (error: unknown, to: { fullPath: string }) => void
    onError(new Error('Cannot read properties of undefined'), { fullPath: '/other' })
    expect(location.assign).not.toHaveBeenCalled()
    expect(location.reload).not.toHaveBeenCalled()

    onError(new TypeError('Failed to fetch dynamically imported module: /a.js'), {
      fullPath: '/other',
    })
    expect(location.assign).toHaveBeenCalledExactlyOnceWith('/base/other')
  })

  it('installs nothing when appConfig.narduk.chunkReload is false', async () => {
    state.appConfig = { narduk: { chunkReload: false } }
    await install()

    expect(listeners.size).toBe(0)
    expect(hooks.size).toBe(0)
    expect(state.router.onError).not.toHaveBeenCalled()
  })
})
