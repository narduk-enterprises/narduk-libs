/**
 * The Nuxt module itself (narduk-libs#422 §b), run against a Nuxt stub.
 *
 * The assertions are all about what the module leaves behind for the runtime:
 * the published `libraries`, the token route, and the runtime-config keys. None
 * of them read the module's source text -- a module that produced the same
 * effects a different way would still pass, which is the point.
 */
import { runWithNuxtContext } from '@nuxt/kit'
import { describe, expect, it, vi } from 'vitest'

import nardukMapKitModule from '../../src/nuxt/index.js'

interface NuxtStub {
  /** `checkNuxtCompatibility` reads this; the module declares `nuxt: '>=4.0.0'`. */
  _version: string
  callHook: (name: string, ...args: unknown[]) => Promise<void>
  hooks: Array<[string, unknown]>
  options: {
    build: { templates: unknown[]; transpile: string[] }
    buildDir: string
    imports: { autoImport: boolean }
    runtimeConfig: Record<string, unknown> & { public: Record<string, unknown> }
    serverHandlers: Array<{ handler: string; method?: string; route: string }>
    vite: { vue?: Record<string, unknown> }
  }
  hook: (name: string, fn: unknown) => void
}

function nuxtStub(runtimeConfig: Record<string, unknown> = {}): NuxtStub {
  const hooks: Array<[string, unknown]> = []
  return {
    _version: '4.5.2',
    callHook: async () => {
      await Promise.resolve()
    },
    hook: (name, fn) => {
      hooks.push([name, fn])
    },
    hooks,
    options: {
      build: { templates: [], transpile: [] },
      buildDir: '/tmp/narduk-mapkit-test/.nuxt',
      imports: { autoImport: true },
      runtimeConfig: { public: {}, ...runtimeConfig } as NuxtStub['options']['runtimeConfig'],
      serverHandlers: [],
      vite: {},
    },
  }
}

/**
 * `addComponent` and `addImports` read the ambient Nuxt context rather than the
 * instance handed to `setup`, so the module runs inside one -- the same way
 * Nuxt itself invokes a module.
 */
async function runModule(nuxt: NuxtStub, options: Record<string, unknown>): Promise<void> {
  await runWithNuxtContext(nuxt as never, async () => {
    await (
      nardukMapKitModule as unknown as (
        inline: Record<string, unknown>,
        nuxt: NuxtStub,
      ) => Promise<void>
    )(options, nuxt)
  })
}

async function setup(
  options: Record<string, unknown> = {},
  runtimeConfig: Record<string, unknown> = {},
): Promise<NuxtStub> {
  const nuxt = nuxtStub(runtimeConfig)
  await runModule(nuxt, options)
  return nuxt
}

describe('the narduk-mapkit Nuxt module (§b)', () => {
  it('publishes the three default libraries for the runtime to read', async () => {
    const nuxt = await setup()

    expect(nuxt.options.runtimeConfig.public['nardukMapKit']).toMatchObject({
      libraries: ['map', 'annotations', 'overlays'],
      ssrPreload: true,
      tokenRoutePath: '/api/mapkit-token',
    })
  })

  it('makes libraries configuration rather than a hard-coded triple', async () => {
    const nuxt = await setup({ libraries: ['map', 'annotations'] })

    expect(nuxt.options.runtimeConfig.public['nardukMapKit']).toMatchObject({
      libraries: ['map', 'annotations'],
    })
  })

  it('refuses an empty libraries list, which loads a namespace with no Map on it', async () => {
    await expect(setup({ libraries: [] })).rejects.toThrow('must name at least one library')
  })

  it('registers the token route and a catch-all for the 405', async () => {
    const nuxt = await setup()

    expect(nuxt.options.serverHandlers).toHaveLength(2)
    expect(nuxt.options.serverHandlers[0]).toMatchObject({
      method: 'get',
      route: '/api/mapkit-token',
    })
    expect(nuxt.options.serverHandlers[1]?.method).toBeUndefined()
    expect(nuxt.options.serverHandlers[1]?.route).toBe('/api/mapkit-token')
  })

  it('moves the route, and the runtime endpoint with it', async () => {
    const nuxt = await setup({ tokenRoutePath: '/_api/mk' })

    expect(nuxt.options.serverHandlers[0]?.route).toBe('/_api/mk')
    expect(nuxt.options.runtimeConfig.public['mapkitTokenEndpoint']).toBe('/_api/mk')
    expect(nuxt.options.runtimeConfig.public['nardukMapKit']).toMatchObject({
      tokenRoutePath: '/_api/mk',
    })
  })

  it('refuses an absolute token route, because the fetch must stay same-origin', async () => {
    await expect(setup({ tokenRoutePath: 'https://tokens.example/mk' })).rejects.toThrow(
      'must start with /',
    )
  })

  it('refuses a protocol-relative token route, which also leaves the origin', async () => {
    // It starts with `/`, so a startsWith check alone lets it through and the
    // failure surfaces later, inside the loader, as a cross-origin fetch.
    await expect(setup({ tokenRoutePath: '//tokens.example/mk' })).rejects.toThrow(
      'must not start with //',
    )
  })

  it.each([
    '/\\evil.example/mk',
    '/\\\\evil.example/mk',
    // WHATWG removes every ASCII tab and newline from the input BEFORE parsing,
    // so a separator split by one is still protocol-relative.
    '/\t/evil.example/mk',
    '/\n/evil.example/mk',
    '/\r/evil.example/mk',
    '/\t\\evil.example/mk',
  ])('refuses a backslash-disguised protocol-relative token route (%s)', async (tokenRoutePath) => {
    // WHATWG treats `\` as `/` in a relative URL, so `/\evil.example/mk`
    // becomes `//evil.example/mk` and the token fetch leaves the origin.
    // A startsWith('//') check does not see the backslash form.
    await expect(setup({ tokenRoutePath })).rejects.toThrow('must not start with //')
  })

  it('registers no route at all when the app serves its own', async () => {
    const nuxt = await setup({ tokenRoute: false })

    expect(nuxt.options.serverHandlers).toStrictEqual([])
  })

  it('seeds the Apple credential keys empty so an app can fill them from env', async () => {
    const nuxt = await setup()

    expect(nuxt.options.runtimeConfig['appleKeyId']).toBe('')
    expect(nuxt.options.runtimeConfig['applePrivateKey']).toBe('')
    expect(nuxt.options.runtimeConfig['appleTeamId']).toBe('')
    // Non-secret, and server-side: a ceiling, not a credential.
    expect(nuxt.options.runtimeConfig['nardukMapKit']).toStrictEqual({
      rateLimit: { limit: 30, windowSeconds: 60 },
    })
  })

  it('never publishes a credential to the client', async () => {
    const nuxt = await setup({}, { applePrivateKey: 'PRIVATE', appleTeamId: 'TEAM123456' })

    expect(JSON.stringify(nuxt.options.runtimeConfig.public)).not.toContain('PRIVATE')
    expect(JSON.stringify(nuxt.options.runtimeConfig.public)).not.toContain('TEAM123456')
  })

  it('names a retired key without reading its value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Swallow the deprecation notice; the assertions read the spy.
    })

    await setup({}, { mapkitAllowedOrigins: 'https://secret.example' })

    const messages = warn.mock.calls.map((call) => String(call[0]))
    expect(messages.join('\n')).toContain('mapkitAllowedOrigins')
    expect(messages.join('\n')).not.toContain('secret.example')
    warn.mockRestore()
  })

  it('names a retired public token key without printing the token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Swallow the deprecation notice; the assertions read the spy.
    })
    const nuxt = nuxtStub()
    nuxt.options.runtimeConfig.public['mapkitToken'] = 'eyJ.static.portal'

    await runModule(nuxt, {})

    const messages = warn.mock.calls.map((call) => String(call[0]))
    expect(messages.join('\n')).toContain('mapkitToken')
    expect(messages.join('\n')).not.toContain('eyJ.static.portal')
    warn.mockRestore()
  })

  it('transpiles its runtime directory, which imports Nuxt own #imports', async () => {
    const nuxt = await setup()

    expect(nuxt.options.build.transpile.some((entry) => entry.endsWith('/runtime'))).toBe(true)
  })
})
