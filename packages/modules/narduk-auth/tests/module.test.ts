import { describe, expect, it, vi } from 'vitest'

describe('narduk-auth module', () => {
  it('registers auth surface without Nuxt layer inheritance', async () => {
    const addComponentsDir = vi.fn()
    const addImportsDir = vi.fn()
    const addServerScanDir = vi.fn()
    const addTemplate = vi.fn((template: { src: string }) => ({
      filename: template.src.endsWith('auth.vue') ? 'auth.vue' : 'blank.vue',
    }))
    const extendPages = vi.fn()
    const extendRouteRules = vi.fn()
    const hooks = new Map<string, Array<(value: never) => void>>()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir,
      addImportsDir,
      addServerScanDir,
      addTemplate,
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      extendPages,
      extendRouteRules,
    }))

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => void
    }
    const nuxt = {
      options: {
        appConfig: {},
        build: { transpile: [] },
        nitro: {},
        runtimeConfig: {},
      },
      hook(name: string, handler: (value: never) => void) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      },
    }

    mod.setup({ app: true, server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-auth')
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
    expect(addTemplate).toHaveBeenCalledWith({
      src: expect.stringContaining('/app/layouts/auth.vue'),
    })
    expect(addTemplate).toHaveBeenCalledWith({
      src: expect.stringContaining('/app/layouts/blank.vue'),
    })
    expect(extendPages).toHaveBeenCalledTimes(1)
    expect(extendRouteRules).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({
        ssr: false,
        headers: expect.objectContaining({
          'Cache-Control': 'private, no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        }),
      }),
    )

    const appResolveState = {
      middleware: [{ name: 'auth', path: '/app-owned/auth.ts' }],
    }
    for (const hook of hooks.get('app:resolve') || []) {
      hook(appResolveState as never)
    }
    expect(appResolveState.middleware).toEqual([
      { name: 'auth', path: '/app-owned/auth.ts' },
      { name: 'guest', path: expect.stringContaining('/app/middleware/guest.ts') },
    ])

    const appTemplateState = {
      layouts: {
        auth: { file: '~/layouts/auth.vue', name: 'auth' },
      },
    }
    for (const hook of hooks.get('app:templates') || []) {
      hook(appTemplateState as never)
    }
    expect(appTemplateState.layouts.auth).toEqual({ file: '~/layouts/auth.vue', name: 'auth' })
    expect(appTemplateState.layouts.blank).toEqual({ file: '#build/blank.vue', name: 'blank' })
  })

  it('tells narduk-core health and build checks that auth needs a database', async () => {
    vi.resetModules()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn((template: { src: string }) => ({
        filename: template.src.split('/').pop(),
      })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      extendPages: vi.fn(),
      extendRouteRules: vi.fn(),
    }))
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => void
    }
    const { findDatabaseBackendConflict } = await import(
      '@narduk-enterprises/narduk-core/shared/database-backend'
    )
    const runtimeConfig: Record<string, unknown> = {
      databaseBackend: 'none',
      nardukHealth: { futureProbe: true },
    }
    const nuxt = {
      options: {
        appConfig: {},
        build: { transpile: [] },
        nitro: {},
        runtimeConfig,
      },
      hook: vi.fn(),
    }

    mod.setup({ app: false, server: false }, nuxt)

    expect(nuxt.options.runtimeConfig.nardukHealth).toEqual({ futureProbe: true, authTables: true })
    expect(findDatabaseBackendConflict(nuxt.options.runtimeConfig)).toContain(
      "databaseBackend 'none' conflicts with @narduk-enterprises/narduk-auth",
    )
  })
})
