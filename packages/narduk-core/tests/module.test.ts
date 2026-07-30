import { describe, expect, it, vi } from 'vitest'

describe('narduk-core module', () => {
  it('registers core aliases without relying on Nuxt layer inheritance', async () => {
    const iconConfigAtNuxtUiInstall: unknown[] = []
    const installModule = vi.fn((name: string) => {
      if (name === '@nuxt/ui') {
        iconConfigAtNuxtUiInstall.push(structuredClone(nuxt.options.icon))
      }
    })
    const addImportsDir = vi.fn()
    const addComponentsDir = vi.fn()
    const addPlugin = vi.fn()
    const addServerScanDir = vi.fn()
    const addTemplate = vi.fn((template: { src: string }) => ({
      filename: template.src.endsWith('dashboard.vue') ? 'dashboard.vue' : 'landing.vue',
    }))
    const hooks = new Map<string, Array<(value: never) => void>>()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir,
      addImportsDir,
      addPlugin,
      addServerScanDir,
      addTemplate,
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule,
    }))
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = {
      options: {
        alias: {},
        app: {},
        appConfig: {},
        build: { transpile: [] },
        colorMode: {},
        css: [],
        devServer: {},
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {},
        ui: {},
        vite: {},
      },
      hook(name: string, handler: (value: never) => void) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      },
    }

    await mod.setup({ app: true, coreModules: true, server: true }, nuxt)

    expect(nuxt.options.alias).toEqual(
      expect.objectContaining({
        '#layer': expect.stringContaining('/runtime'),
        '#narduk-core/schema': expect.stringContaining('/runtime/server/database/schema.ts'),
        '#narduk-core/postgres-runtime': expect.stringContaining(
          '/runtime/internal/postgres-runtime.stub.ts',
        ),
      }),
    )
    expect(Object.keys(nuxt.options.alias).filter((alias) => alias.startsWith('#layer/'))).toEqual(
      [],
    )
    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-core')
    expect(nuxt.options.appConfig).toEqual(
      expect.objectContaining({
        ui: {
          colors: {
            primary: 'emerald',
            neutral: 'slate',
          },
        },
      }),
    )
    expect(JSON.stringify(nuxt.options.app)).not.toMatch(/apple-touch|favicon|manifest/u)
    expect(nuxt.options.runtimeConfig).toMatchObject({
      public: expect.not.objectContaining({ controlPlaneUrl: expect.anything() }),
    })
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/app/composables'))
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/app/utils'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/server'))
    expect(installModule).toHaveBeenCalledWith('@nuxt/ui')
    expect(iconConfigAtNuxtUiInstall[0]).toEqual({
      provider: 'server',
      fallbackToApi: false,
      clientBundle: {
        icons: ['lucide:menu', 'lucide:monitor', 'lucide:moon', 'lucide:sun', 'lucide:x'],
      },
      serverBundle: {
        collections: ['lucide'],
        remote: false,
      },
    })
    expect(installModule).toHaveBeenCalledWith('@nuxt/image')
    expect(addTemplate).toHaveBeenCalledWith({
      src: expect.stringContaining('/runtime/app/layouts/dashboard.vue'),
    })
    expect(addTemplate).toHaveBeenCalledWith({
      src: expect.stringContaining('/runtime/app/layouts/landing.vue'),
    })
    const appTemplateState: {
      layouts: Record<string, { file: string; name: string }>
    } = {
      layouts: {
        dashboard: { file: '~/layouts/dashboard.vue', name: 'dashboard' },
      },
    }
    for (const hook of hooks.get('app:templates') || []) {
      hook(appTemplateState as never)
    }
    expect(appTemplateState.layouts.dashboard).toEqual({
      file: '~/layouts/dashboard.vue',
      name: 'dashboard',
    })
    expect(appTemplateState.layouts.landing).toEqual({
      file: '#build/landing.vue',
      name: 'landing',
    })
    expect(hooks.has('vite:extendConfig')).toBe(true)

    installModule.mockClear()
    await mod.setup({ app: false, coreModules: true, image: false, server: false }, nuxt)
    expect(installModule).toHaveBeenCalledWith('@nuxt/ui')
    expect(installModule).not.toHaveBeenCalledWith('@nuxt/image')

    const previousDatabaseBackend = process.env.NUXT_DATABASE_BACKEND
    try {
      process.env.NUXT_DATABASE_BACKEND = 'postgres'
      await mod.setup({ app: false, coreModules: false, server: false }, nuxt)
      expect(nuxt.options.alias).toEqual(
        expect.objectContaining({
          '#narduk-core/schema': expect.stringContaining('/runtime/server/database/pg-schema.ts'),
          '#narduk-core/postgres-runtime': expect.stringContaining(
            '/runtime/internal/postgres-runtime.ts',
          ),
        }),
      )
    } finally {
      if (previousDatabaseBackend === undefined) {
        delete process.env.NUXT_DATABASE_BACKEND
      } else {
        process.env.NUXT_DATABASE_BACKEND = previousDatabaseBackend
      }
    }
  })
})
