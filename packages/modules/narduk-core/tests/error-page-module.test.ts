import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeNuxt {
  hook: (name: string, handler: (value: never) => void) => void
  options: Record<string, unknown>
}

const registered = {
  hooks: new Map<string, Array<(value: never) => void>>(),
  plugins: [] as string[],
}

async function setupModule(): Promise<FakeNuxt> {
  registered.hooks = new Map()
  registered.plugins = []
  vi.resetModules()
  vi.doMock('@nuxt/kit', () => ({
    addComponentsDir: vi.fn(),
    addImportsDir: vi.fn(),
    addPlugin: vi.fn((src: string) => registered.plugins.push(src)),
    addServerScanDir: vi.fn(),
    addTemplate: vi.fn(() => ({ filename: 'layout.vue' })),
    createResolver: (url: string) => ({
      resolve: (path: string) => new URL(path, url).pathname,
    }),
    defineNuxtModule: (definition: unknown) => definition,
    installModule: vi.fn(),
  }))

  const mod = (await import('../src/module')).default as unknown as {
    setup: (options: unknown, nuxt: FakeNuxt) => Promise<void>
  }
  const nuxt: FakeNuxt = {
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
    hook(name, handler) {
      registered.hooks.set(name, [...(registered.hooks.get(name) ?? []), handler])
    },
  }

  await mod.setup({ app: true, coreModules: false, server: true }, nuxt)
  return nuxt
}

function resolveApp(app: { errorComponent?: string | null }): { errorComponent?: string | null } {
  for (const handler of registered.hooks.get('app:resolve') ?? []) {
    ;(handler as unknown as (value: typeof app) => void)(app)
  }
  return app
}

describe('module-provided error page', () => {
  beforeEach(async () => {
    await setupModule()
  })

  it('replaces the Nuxt built-in fallback, so an app needs no error.vue of its own', () => {
    // What nuxt 4.4's resolveApp() assigns when no layer or app file was found,
    // immediately before it calls app:resolve.
    const app = resolveApp({
      errorComponent: '/repo/node_modules/nuxt/dist/app/components/nuxt-error-page.vue',
    })

    expect(app.errorComponent).toMatch(/\/runtime\/app\/error\.vue$/)
  })

  it('leaves an app-owned error.vue alone', () => {
    const app = resolveApp({ errorComponent: '/repo/apps/web/app/error.vue' })

    expect(app.errorComponent).toBe('/repo/apps/web/app/error.vue')
  })

  it('leaves a layer-provided error page alone', () => {
    const app = resolveApp({ errorComponent: '/repo/layers/brand/app/error.vue' })

    expect(app.errorComponent).toBe('/repo/layers/brand/app/error.vue')
  })

  it('claims an unset error component rather than leaving Nuxt without one', () => {
    expect(resolveApp({}).errorComponent).toMatch(/\/runtime\/app\/error\.vue$/)
    expect(resolveApp({ errorComponent: null }).errorComponent).toMatch(
      /\/runtime\/app\/error\.vue$/,
    )
  })

  it('registers the client exception-capture plugin', () => {
    expect(registered.plugins).toEqual(
      expect.arrayContaining([expect.stringMatching(/exception-capture\.client$/)]),
    )
  })
})

describe('module-provided error page without the app surface', () => {
  it('registers nothing when nardukCore.app is off', async () => {
    registered.hooks = new Map()
    registered.plugins = []
    vi.resetModules()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn((src: string) => registered.plugins.push(src)),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn(() => ({ filename: 'layout.vue' })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule: vi.fn(),
    }))
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: FakeNuxt) => Promise<void>
    }
    const nuxt: FakeNuxt = {
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
      hook(name, handler) {
        registered.hooks.set(name, [...(registered.hooks.get(name) ?? []), handler])
      },
    }

    await mod.setup({ app: false, coreModules: false, server: true }, nuxt)

    expect(registered.hooks.has('app:resolve')).toBe(false)
    expect(registered.plugins).toEqual([])
  })
})
