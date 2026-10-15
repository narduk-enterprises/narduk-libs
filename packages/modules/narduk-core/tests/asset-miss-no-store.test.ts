import { describe, expect, it, vi } from 'vitest'

import {
  isAssetMissNoStoreEnabled,
  withUncachedAssetMiss,
  withUncachedAssetMissEnv,
  withUncachedAssetMissHandler,
} from '../runtime/shared/asset-miss-no-store'
import {
  applyAssetMissNoStoreEntry,
  CLOUDFLARE_MODULE_ENTRY_ALIAS,
} from '../src/cloudflare-asset-miss-entry'

// The preset's own entry, driven for real: its three virtual specifiers are the
// only thing replaced. `isPublicAssetURL` is Nitro's matcher for built assets.
vi.mock('#nitro-internal-pollyfills', () => ({}))
vi.mock('#nitro-internal-virtual/public-assets', () => ({
  isPublicAssetURL: (path: string) => path.startsWith('/_nuxt/'),
}))
vi.mock('crossws/adapters/cloudflare', () => ({ default: () => ({}) }))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ localFetch: async () => new Response('from nitro app', { status: 200 }) }),
}))
vi.mock('nitropack/runtime/internal', () => ({
  requestHasBody: () => false,
  runCronTasks: async () => {},
}))
vi.mock('#narduk-core/cloudflare-module-entry', async () => ({
  default: (await import('nitropack/presets/cloudflare/runtime/cloudflare-module')).default,
}))
vi.mock('#internal/nuxt/app-config', () => ({ default: { narduk: {} } }))

const MISSING_CHUNK = 'https://app.test/_nuxt/gone.js'
const CACHE_CONTROL = 'cache-control'
const NO_STORE = 'no-store'
const IMMUTABLE = 'public, max-age=31536000, immutable'

/** What Workers Static Assets answers once Nitro's `_headers` rule has stamped it. */
function assetsBinding(status: number, body = 'asset body') {
  const fetch = vi.fn(
    async (_request: Request) =>
      new Response(status === 404 ? 'Not Found' : body, {
        headers: { [CACHE_CONTROL]: IMMUTABLE, 'content-type': 'text/javascript', etag: '"v1"' },
        status,
        statusText: status === 404 ? 'Not Found' : 'OK',
      }),
  )
  return { binding: { fetch }, fetch }
}

const context = { waitUntil: () => {} } as never

async function dispatch(handler: { fetch?: unknown }, url: string, env: object): Promise<Response> {
  return (await (handler.fetch as (...args: unknown[]) => unknown)(
    new Request(url),
    env,
    context,
  )) as Response
}

describe('withUncachedAssetMiss', () => {
  it('answers an asset 404 no-store and keeps its status, body and other headers', async () => {
    const { binding, fetch } = assetsBinding(404)
    const request = new Request(MISSING_CHUNK)

    const response = await withUncachedAssetMiss(binding).fetch(request)

    expect(fetch).toHaveBeenCalledWith(request)
    expect(response.status).toBe(404)
    expect(response.statusText).toBe('Not Found')
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
    expect(response.headers.get('content-type')).toBe('text/javascript')
    expect(response.headers.get('etag')).toBe('"v1"')
    expect(await response.text()).toBe('Not Found')
  })

  it('returns a 200 as the same object, cache-control untouched', async () => {
    const { binding } = assetsBinding(200)
    const response = await withUncachedAssetMiss(binding).fetch(
      new Request('https://app.test/_nuxt/entry.js'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(CACHE_CONTROL)).toBe(IMMUTABLE)
    expect(await response.text()).toBe('asset body')
  })

  it.each([200, 206, 301, 304, 500])('leaves a %i alone', async (status) => {
    const original = new Response(null, { headers: { [CACHE_CONTROL]: IMMUTABLE }, status })
    const binding = { fetch: vi.fn(async () => original) }

    const response = await withUncachedAssetMiss(binding).fetch(new Request('https://app.test/x'))

    expect(response).toBe(original)
  })

  it('wraps a binding once', () => {
    const { binding } = assetsBinding(200)
    expect(withUncachedAssetMiss(binding)).toBe(withUncachedAssetMiss(binding))
  })
})

describe('withUncachedAssetMissEnv', () => {
  it('swaps ASSETS only and leaves every other binding the same object', () => {
    const db = { prepare: () => {} }
    const { binding } = assetsBinding(200)
    const env = { ASSETS: binding, DB: db, NAME: 'worker' }

    const wrapped = withUncachedAssetMissEnv(env)

    expect(wrapped.ASSETS).not.toBe(binding)
    expect(wrapped.DB).toBe(db)
    expect(wrapped.NAME).toBe('worker')
    expect(Object.keys(wrapped)).toEqual(['ASSETS', 'DB', 'NAME'])
  })

  it('returns env itself when it has no usable ASSETS', () => {
    const noAssets = { DB: {} }
    expect(withUncachedAssetMissEnv(noAssets)).toBe(noAssets)
    const brokenAssets = { ASSETS: {} }
    expect(withUncachedAssetMissEnv(brokenAssets)).toBe(brokenAssets)
  })
})

describe('the real cloudflare-module entry behind the wrapper', () => {
  async function entry(enabled: boolean) {
    const real = (await import('nitropack/presets/cloudflare/runtime/cloudflare-module')).default
    return withUncachedAssetMissHandler(real, enabled)
  }

  it('answers a missing /_nuxt chunk 404 with no-store', async () => {
    const { binding, fetch } = assetsBinding(404)

    const response = await dispatch(await entry(true), MISSING_CHUNK, {
      ASSETS: binding,
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(404)
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
  })

  it('leaves a served /_nuxt chunk exactly as the assets layer answered it', async () => {
    const { binding } = assetsBinding(200)

    const response = await dispatch(await entry(true), 'https://app.test/_nuxt/entry.js', {
      ASSETS: binding,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get(CACHE_CONTROL)).toBe(IMMUTABLE)
    expect(await response.text()).toBe('asset body')
  })

  it('does not ask ASSETS for a non-asset route', async () => {
    const { binding, fetch } = assetsBinding(404)

    const response = await dispatch(await entry(true), 'https://app.test/api/health', {
      ASSETS: binding,
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(await response.text()).toBe('from nitro app')
  })

  it('opted out, hands the preset the original env and leaves the 404 as it was', async () => {
    const { binding } = assetsBinding(404)

    const response = await dispatch(await entry(false), MISSING_CHUNK, {
      ASSETS: binding,
    })

    expect(response.status).toBe(404)
    expect(response.headers.get(CACHE_CONTROL)).toBe(IMMUTABLE)
  })

  it('still hands the other Worker handlers the original env', async () => {
    const real = { fetch: vi.fn(), scheduled: vi.fn() }
    const wrapped = withUncachedAssetMissHandler(real, true)
    const env = { ASSETS: assetsBinding(200).binding }

    ;(wrapped as unknown as { scheduled: (...args: unknown[]) => void }).scheduled({}, env)

    expect(real.scheduled).toHaveBeenCalledWith({}, env)
  })
})

describe('the wrapper entry module', () => {
  it('default-exports a handler whose fetch answers an asset 404 no-store', async () => {
    const wrapper = (await import('../runtime/nitro/cloudflare-module')).default
    const { binding } = assetsBinding(404)

    const response = await dispatch(wrapper, MISSING_CHUNK, { ASSETS: binding })

    expect(response.status).toBe(404)
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE)
  })
})

describe('isAssetMissNoStoreEnabled', () => {
  it.each([
    undefined,
    null,
    {},
    { narduk: null },
    { narduk: {} },
    { narduk: { chunkReload: false } },
  ])('is on for %j', (config) => {
    expect(isAssetMissNoStoreEnabled(config)).toBe(true)
  })

  it('is off only for an explicit false', () => {
    expect(isAssetMissNoStoreEnabled({ narduk: { assetMissNoStore: false } })).toBe(false)
    expect(isAssetMissNoStoreEnabled({ narduk: { assetMissNoStore: 0 } })).toBe(true)
  })
})

describe('applyAssetMissNoStoreEntry', () => {
  const wrapper = '/pkg/runtime/nitro/cloudflare-module.ts'
  const presetEntry = '/nm/nitropack/dist/presets/cloudflare/runtime/cloudflare-module'

  function host(entry: string | undefined, dev = false) {
    return { options: { alias: { '~': '/app' }, dev, entry } }
  }

  it.each([presetEntry, `${presetEntry}.mjs`, presetEntry.replaceAll('/', '\\')])(
    'swaps the cloudflare_module entry (%s) and aliases the original',
    (entry) => {
      const nitro = host(entry)

      expect(applyAssetMissNoStoreEntry(nitro, wrapper)).toBe(true)
      expect(nitro.options.entry).toBe(wrapper)
      expect(nitro.options.alias).toEqual({
        '~': '/app',
        [CLOUDFLARE_MODULE_ENTRY_ALIAS]: entry,
      })
    },
  )

  it.each([
    ['cloudflare_durable', '/nm/nitropack/dist/presets/cloudflare/runtime/cloudflare-durable'],
    ['legacy module', '/nm/nitropack/dist/presets/cloudflare/runtime/cloudflare-module-legacy'],
    ['pages', '/nm/nitropack/dist/presets/cloudflare/runtime/cloudflare-pages'],
    ['node-server', '/nm/nitropack/dist/presets/node/runtime/node-server'],
    ['an app entry', '/app/server/my-entry.ts'],
  ])('leaves %s alone', (_name, entry) => {
    const nitro = host(entry)

    expect(applyAssetMissNoStoreEntry(nitro, wrapper)).toBe(false)
    expect(nitro.options.entry).toBe(entry)
    expect(nitro.options.alias).toEqual({ '~': '/app' })
  })

  it('leaves a dev build and a build with no entry alone', () => {
    expect(applyAssetMissNoStoreEntry(host(presetEntry, true), wrapper)).toBe(false)
    expect(applyAssetMissNoStoreEntry(host(undefined), wrapper)).toBe(false)
  })

  it('leaves the entry alone when nuxt.config opts out', () => {
    const nitro = host(presetEntry)

    expect(
      applyAssetMissNoStoreEntry(nitro, wrapper, { narduk: { assetMissNoStore: false } }),
    ).toBe(false)
    expect(nitro.options.entry).toBe(presetEntry)
  })
})
