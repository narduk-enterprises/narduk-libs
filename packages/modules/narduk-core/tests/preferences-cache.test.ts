import { createServer } from 'node:http'

import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setCacheProfile } from '../runtime/server/utils/cacheProfile'
import { readPreferences } from '../runtime/server/utils/preferences'
import {
  markPreferencesInfluenced,
  NE_PREFERENCES_INFLUENCED_CONTEXT_KEY,
} from '../runtime/shared/utils/preferences'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({}),
}))
vi.mock('../runtime/server/utils/runtime-public', () => ({
  resolveRuntimePublicOverlay: () => ({ previewSafeMode: false }),
}))

const { applyPreferencesCacheHeaders, default: plugin } =
  await import('../runtime/server/plugins/preferences-cache')

const CACHEABLE = 'public, max-age=60'
const LIVE_CDN = 'public, max-age=300, stale-while-revalidate=900'
const NO_STORE = 'private, no-store'

interface RenderResponse {
  headers: Record<string, string | undefined>
}
type RenderHook = (response: RenderResponse, context: { event?: unknown }) => void
type BeforeResponseHook = (event: H3Event, response?: unknown) => void

interface InstalledHooks {
  beforeResponse: BeforeResponseHook | undefined
  renderResponse: RenderHook
}

/** Register the plugin against a fake Nitro and hand back the hooks it installed. */
function installedHooks(): InstalledHooks {
  let renderResponse: RenderHook | undefined
  let beforeResponse: BeforeResponseHook | undefined
  const nitro = {
    hooks: {
      hook: (name: string, handler: RenderHook | BeforeResponseHook) => {
        if (name === 'render:response') renderResponse = handler as RenderHook
        if (name === 'beforeResponse') beforeResponse = handler as BeforeResponseHook
      },
    },
  }

  ;(plugin as (nitro: unknown) => void)(nitro)
  if (!renderResponse) throw new Error('plugin registered no render:response hook')
  return { beforeResponse, renderResponse }
}

function varyTokens(vary: string | null | undefined): string[] {
  return (vary ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Drive a real h3 handler through the plugin's `beforeResponse` hook, the way
 * Nitro does for API routes (`render:response` never runs there).
 */
async function apiRespond(
  handler: (event: H3Event) => unknown,
): Promise<{ body: string; headers: Headers; status: number }> {
  const { beforeResponse } = installedHooks()
  if (!beforeResponse) throw new Error('plugin registered no beforeResponse hook')
  const app = createApp({
    onBeforeResponse: (event, response) => {
      beforeResponse(event, response)
    },
  }).use(
    defineEventHandler((event) => {
      const result = handler(event)
      return result === undefined ? 'ok' : result
    }),
  )
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    return { body: await response.text(), headers: response.headers, status: response.status }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

/**
 * A page rendered with one reader's units must never reach another reader out
 * of a shared cache (narduk-libs#386). `setCacheProfile` covers a route that
 * sets its own posture; this plugin covers the rendered SSR document, which is
 * the response that actually carries the preference-shaped HTML.
 */
describe('preferences-cache Nitro plugin', () => {
  it('leaves a response alone when nothing read preferences', () => {
    const { renderResponse } = installedHooks()
    const response: RenderResponse = { headers: { 'cache-control': CACHEABLE } }

    renderResponse(response, { event: { context: {} } })

    expect(response.headers).toEqual({ 'cache-control': CACHEABLE })
  })

  it('leaves a response alone when there is no event at all', () => {
    const { renderResponse } = installedHooks()
    const response: RenderResponse = { headers: { 'cache-control': CACHEABLE } }

    expect(() => renderResponse(response, {})).not.toThrow()
    expect(response.headers['cache-control']).toBe(CACHEABLE)
  })

  it('forces private, no-store with Vary: Cookie once preferences were read', () => {
    const { renderResponse } = installedHooks()
    const event = { context: {} as Record<string, unknown> }
    markPreferencesInfluenced(event)
    const response: RenderResponse = {
      headers: { 'cache-control': CACHEABLE, 'content-type': 'text/html' },
    }

    renderResponse(response, { event })

    expect(response.headers['cache-control']).toBe(NO_STORE)
    expect(response.headers['content-type']).toBe('text/html')
    expect(varyTokens(response.headers.vary)).toEqual(expect.arrayContaining(['cookie']))
  })

  it('strips leftover CDN and surrogate headers that would override Cache-Control', () => {
    const { renderResponse } = installedHooks()
    const event = { context: {} as Record<string, unknown> }
    markPreferencesInfluenced(event)
    const response: RenderResponse = {
      headers: {
        'cache-control': CACHEABLE,
        'CDN-Cache-Control': LIVE_CDN,
        'Cloudflare-CDN-Cache-Control': 'public, max-age=60',
        'Surrogate-Control': 'max-age=60',
        'Cache-Tag': 'stations',
        Expires: 'Wed, 08 Mar 2026 00:00:00 GMT',
        Age: '12',
        'content-type': 'text/html',
      },
    }

    renderResponse(response, { event })

    expect(response.headers['cache-control']).toBe(NO_STORE)
    expect(response.headers['content-type']).toBe('text/html')
    expect(response.headers['CDN-Cache-Control']).toBeUndefined()
    expect(response.headers['Cloudflare-CDN-Cache-Control']).toBeUndefined()
    expect(response.headers['Surrogate-Control']).toBeUndefined()
    expect(response.headers['Cache-Tag']).toBeUndefined()
    expect(response.headers.Expires).toBeUndefined()
    expect(response.headers.Age).toBeUndefined()
    expect(varyTokens(response.headers.vary)).toEqual(
      expect.arrayContaining(['cookie', 'accept-language']),
    )
  })

  it('merges Cookie and Accept-Language into an existing Vary without clobbering it', () => {
    const headers = applyPreferencesCacheHeaders({ Vary: 'Accept-Encoding' })
    expect(headers['cache-control']).toBe(NO_STORE)
    expect(varyTokens(headers.vary)).toEqual(
      expect.arrayContaining(['accept-encoding', 'cookie', 'accept-language']),
    )
  })

  it('never emits two spellings of the same header', () => {
    const headers = applyPreferencesCacheHeaders({
      'Cache-Control': CACHEABLE,
      Vary: 'Accept-Encoding',
      vary: 'Cookie',
    })

    expect(
      Object.keys(headers)
        .map((name) => name.toLowerCase())
        .sort(),
    ).toEqual(['cache-control', 'vary'])
    expect(varyTokens(headers.vary)).toEqual(
      expect.arrayContaining(['accept-encoding', 'cookie', 'accept-language']),
    )
  })

  it('leaves a wildcard Vary alone', () => {
    expect(applyPreferencesCacheHeaders({ vary: '*' }).vary).toBe('*')
  })
})

describe('preferences-cache beforeResponse (API routes)', () => {
  it('registers a beforeResponse hook so API routes have a last-moment backstop', () => {
    expect(installedHooks().beforeResponse).toEqual(expect.any(Function))
  })

  it('ends private when setCacheProfile runs before readPreferences', async () => {
    const { headers } = await apiRespond((event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
      readPreferences(event)
      return { ok: true }
    })

    expect(headers.get('cache-control')).toBe(NO_STORE)
    expect(headers.get('cdn-cache-control')).toBeNull()
    expect(headers.get('cloudflare-cdn-cache-control')).toBeNull()
    expect(headers.get('surrogate-control')).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
    expect(varyTokens(headers.get('vary'))).toEqual(
      expect.arrayContaining(['cookie', 'accept-language']),
    )
  })

  it('ends private when readPreferences runs before setCacheProfile', async () => {
    const { headers } = await apiRespond((event) => {
      readPreferences(event)
      setCacheProfile(event, 'live', { tags: ['stations'] })
      return { ok: true }
    })

    expect(headers.get('cache-control')).toBe(NO_STORE)
    expect(headers.get('cdn-cache-control')).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })

  it('re-checks a flag set without going through markPreferencesInfluenced', async () => {
    const { headers } = await apiRespond((event) => {
      setCacheProfile(event, 'live', { tags: ['stations'] })
      event.context[NE_PREFERENCES_INFLUENCED_CONTEXT_KEY] = true
    })

    expect(headers.get('cache-control')).toBe(NO_STORE)
    expect(headers.get('cdn-cache-control')).toBeNull()
    expect(headers.get('cache-tag')).toBeNull()
  })
})

describe('preferences-cache render:response order (SSR)', () => {
  it('rewrites public SSR headers when the event is marked first', () => {
    const { renderResponse } = installedHooks()
    const event = { context: {} as Record<string, unknown> }
    markPreferencesInfluenced(event)
    const response: RenderResponse = {
      headers: {
        'cache-control': CACHEABLE,
        'CDN-Cache-Control': LIVE_CDN,
        'Cache-Tag': 'stations',
      },
    }

    renderResponse(response, { event })

    expect(response.headers['cache-control']).toBe(NO_STORE)
    expect(response.headers['CDN-Cache-Control']).toBeUndefined()
    expect(response.headers['Cache-Tag']).toBeUndefined()
  })

  it('rewrites public SSR headers when they were already set before the mark', () => {
    const { renderResponse } = installedHooks()
    const response: RenderResponse = {
      headers: {
        'cache-control': CACHEABLE,
        'CDN-Cache-Control': LIVE_CDN,
        'Cache-Tag': 'stations',
      },
    }
    const event = { context: {} as Record<string, unknown> }
    markPreferencesInfluenced(event)

    renderResponse(response, { event })

    expect(response.headers['cache-control']).toBe(NO_STORE)
    expect(response.headers['CDN-Cache-Control']).toBeUndefined()
    expect(response.headers['Cache-Tag']).toBeUndefined()
  })
})

describe('Nitro cached-handler incompatibility warning', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    const { resetPreferenceCacheWarningsForTests } =
      await import('../runtime/server/plugins/preferences-cache')
    resetPreferenceCacheWarningsForTests()
  })

  it('warns once per route in dev when a marked response ran inside a Nitro cached handler', async () => {
    const { warnIfPreferenceResponseInsideNitroCache } =
      await import('../runtime/server/plugins/preferences-cache')
    expect(typeof warnIfPreferenceResponseInsideNitroCache).toBe('function')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const event = {
      path: '/stations',
      context: {
        cache: { options: { swr: true } },
        [NE_PREFERENCES_INFLUENCED_CONTEXT_KEY]: true,
      },
    }

    warnIfPreferenceResponseInsideNitroCache(event, true)
    warnIfPreferenceResponseInsideNitroCache(event, true)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0])).toMatch(/routeRules|cached handler/i)
    expect(String(warn.mock.calls[0])).toMatch(/\/stations/)
  })

  it('is silent outside development and when Nitro did not wrap the handler', async () => {
    const { warnIfPreferenceResponseInsideNitroCache } =
      await import('../runtime/server/plugins/preferences-cache')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnIfPreferenceResponseInsideNitroCache(
      {
        path: '/live',
        context: {
          cache: { options: { swr: true } },
          [NE_PREFERENCES_INFLUENCED_CONTEXT_KEY]: true,
        },
      },
      false,
    )
    warnIfPreferenceResponseInsideNitroCache(
      {
        path: '/plain',
        context: { [NE_PREFERENCES_INFLUENCED_CONTEXT_KEY]: true },
      },
      true,
    )
    expect(warn).not.toHaveBeenCalled()
  })
})
