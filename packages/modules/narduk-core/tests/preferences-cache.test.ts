import { describe, expect, it, vi } from 'vitest'

import { markPreferencesInfluenced } from '../runtime/shared/utils/preferences'

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
}))

const { applyPreferencesCacheHeaders, default: plugin } = await import(
  '../runtime/server/plugins/preferences-cache'
)

type RenderResponse = { headers: Record<string, string | undefined> }
type RenderHook = (response: RenderResponse, context: { event?: unknown }) => void

/** Register the plugin against a fake Nitro and hand back its `render:response` hook. */
function installedHook(): RenderHook {
  let hook: RenderHook | undefined
  const nitro = {
    hooks: {
      hook: (name: string, handler: RenderHook) => {
        if (name === 'render:response') hook = handler
      },
    },
  }

  ;(plugin as (nitro: unknown) => void)(nitro)
  if (!hook) throw new Error('plugin registered no render:response hook')
  return hook
}

/**
 * A page rendered with one reader's units must never reach another reader out
 * of a shared cache (narduk-libs#386). `setCacheProfile` covers a route that
 * sets its own posture; this plugin covers the rendered SSR document, which is
 * the response that actually carries the preference-shaped HTML.
 */
describe('preferences-cache Nitro plugin', () => {
  it('leaves a response alone when nothing read preferences', () => {
    const hook = installedHook()
    const response: RenderResponse = { headers: { 'cache-control': 'public, max-age=60' } }

    hook(response, { event: { context: {} } })

    expect(response.headers).toEqual({ 'cache-control': 'public, max-age=60' })
  })

  it('leaves a response alone when there is no event at all', () => {
    const hook = installedHook()
    const response: RenderResponse = { headers: { 'cache-control': 'public, max-age=60' } }

    expect(() => hook(response, {})).not.toThrow()
    expect(response.headers['cache-control']).toBe('public, max-age=60')
  })

  it('forces private, no-store with Vary: Cookie once preferences were read', () => {
    const hook = installedHook()
    const event = { context: {} as Record<string, unknown> }
    markPreferencesInfluenced(event)
    const response: RenderResponse = {
      headers: { 'cache-control': 'public, max-age=60', 'content-type': 'text/html' },
    }

    hook(response, { event })

    expect(response.headers).toEqual({
      'cache-control': 'private, no-store',
      'content-type': 'text/html',
      vary: 'Cookie',
    })
  })

  it('merges into an existing Vary whatever case it was written in', () => {
    expect(applyPreferencesCacheHeaders({ Vary: 'Accept-Encoding' })).toEqual({
      'cache-control': 'private, no-store',
      vary: 'Accept-Encoding, Cookie',
    })
  })

  it('never emits two spellings of the same header', () => {
    const headers = applyPreferencesCacheHeaders({
      'Cache-Control': 'public, max-age=60',
      Vary: 'Accept-Encoding',
      vary: 'Cookie',
    })

    expect(Object.keys(headers).map((name) => name.toLowerCase())).toEqual([
      'cache-control',
      'vary',
    ])
    expect(headers.vary).toBe('Accept-Encoding, Cookie')
  })

  it('leaves a wildcard Vary alone', () => {
    expect(applyPreferencesCacheHeaders({ vary: '*' }).vary).toBe('*')
  })
})
