import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('narduk-core databaseBackend declaration', () => {
  let previousDatabaseBackend: string | undefined

  beforeEach(() => {
    previousDatabaseBackend = process.env.NUXT_DATABASE_BACKEND
    delete process.env.NUXT_DATABASE_BACKEND
  })

  afterEach(() => {
    if (previousDatabaseBackend === undefined) {
      delete process.env.NUXT_DATABASE_BACKEND
    } else {
      process.env.NUXT_DATABASE_BACKEND = previousDatabaseBackend
    }
  })

  async function loadCoreModule() {
    vi.resetModules()
    const hooks = new Map<string, Array<() => unknown>>()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn((template: { src: string }) => ({
        filename: template.src.split('/').pop(),
      })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule: vi.fn(),
    }))
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = {
      options: {
        alias: {} as Record<string, string>,
        app: {},
        appConfig: {},
        build: { transpile: [] },
        colorMode: {},
        css: [],
        devServer: {},
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {} as Record<string, unknown>,
        ui: {},
        vite: {},
      },
      hook(name: string, handler: () => unknown) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      },
    }
    const setup = (options: Record<string, unknown> = {}) =>
      mod.setup({ app: false, coreModules: false, server: false, ...options }, nuxt)
    const modulesDone = () => {
      for (const hook of hooks.get('modules:done') || []) {
        hook()
      }
    }
    return { nuxt, setup, modulesDone }
  }

  it('records an undeclared D1 default and keeps it undeclared across repeated setup', async () => {
    const { nuxt, setup } = await loadCoreModule()

    await setup()
    await setup()

    expect(nuxt.options.runtimeConfig).toMatchObject({
      databaseBackend: 'd1',
      databaseBackendSource: 'default',
    })
  })

  it.each([
    [{ databaseBackend: 'none' }, undefined, 'none', 'option'],
    [{ databaseBackend: 'none' }, 'postgres', 'none', 'option'],
    [{}, 'postgres', 'postgres', 'env'],
    [{}, 'none', 'none', 'env'],
  ])(
    'resolves option %j with NUXT_DATABASE_BACKEND=%s to %s from %s',
    async (options, env, databaseBackend, databaseBackendSource) => {
      if (env !== undefined) {
        process.env.NUXT_DATABASE_BACKEND = env
      }
      const { nuxt, setup } = await loadCoreModule()

      await setup(options)

      expect(nuxt.options.runtimeConfig).toMatchObject({ databaseBackend, databaseBackendSource })
      expect(nuxt.options.alias['#narduk-core/schema']).toContain(
        databaseBackend === 'postgres'
          ? '/runtime/server/database/pg-schema.ts'
          : '/runtime/server/database/schema.ts',
      )
    },
  )

  it('rejects an unknown databaseBackend option', async () => {
    const { setup } = await loadCoreModule()

    await expect(setup({ databaseBackend: 'sqlite' })).rejects.toThrow(
      "nardukCore.databaseBackend must be one of 'd1', 'postgres', 'none'",
    )
  })

  it.each([
    ['the narduk-auth health flag', { nardukHealth: { authTables: true } }],
    ['an authBackend from an older narduk-auth', { authBackend: 'local' }],
  ])(
    'fails the build when an app without a database also installs narduk-auth, detected by %s (Q3)',
    async (_label, authRuntimeConfig) => {
      const { nuxt, setup, modulesDone } = await loadCoreModule()

      await setup({ databaseBackend: 'none' })
      // narduk-auth installs after narduk-core, so the check runs once every module is set up.
      Object.assign(nuxt.options.runtimeConfig, authRuntimeConfig)

      expect(modulesDone).toThrow(
        "[narduk-core] databaseBackend 'none' conflicts with @narduk-enterprises/narduk-auth",
      )
    },
  )

  it.each([
    [{ databaseBackend: 'none' }, {}],
    [{ databaseBackend: 'd1' }, { nardukHealth: { authTables: true }, authBackend: 'local' }],
    [{}, { nardukHealth: { authTables: true } }],
  ])('allows option %j with runtime config %j', async (options, authRuntimeConfig) => {
    const { nuxt, setup, modulesDone } = await loadCoreModule()

    await setup(options)
    Object.assign(nuxt.options.runtimeConfig, authRuntimeConfig)

    expect(modulesDone).not.toThrow()
  })
})

describe('narduk-core colorMode defaults', () => {
  async function loadCoreModule(colorMode: Record<string, unknown> = {}) {
    vi.resetModules()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn((template: { src: string }) => ({
        filename: template.src.split('/').pop(),
      })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule: vi.fn(),
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
        colorMode,
        css: [],
        devServer: {},
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {},
        ui: {},
        vite: {},
      },
      hook() {},
    }
    await mod.setup({ app: false, coreModules: false, server: false }, nuxt)
    return nuxt
  }

  it('sets classSuffix to empty so Tailwind v4 / Nuxt UI 4 match .dark', async () => {
    const nuxt = await loadCoreModule()

    expect(nuxt.options.colorMode).toEqual(
      expect.objectContaining({
        preference: 'system',
        fallback: 'dark',
        classSuffix: '',
      }),
    )
  })

  it('lets an app override classSuffix through the same defu defaults', async () => {
    const nuxt = await loadCoreModule({ classSuffix: '-mode' })

    expect(nuxt.options.colorMode).toEqual(
      expect.objectContaining({
        classSuffix: '-mode',
        preference: 'system',
        fallback: 'dark',
      }),
    )
  })
})
