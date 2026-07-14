import { describe, expect, it, vi } from 'vitest'

describe('narduk-core module', () => {
  it('registers core aliases without relying on Nuxt layer inheritance', async () => {
    const installModule = vi.fn()
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
        '#layer/orm-tables': expect.stringContaining('/runtime/server/database/schema.ts'),
        '#layer/postgres-runtime': expect.stringContaining(
          '/runtime/internal/postgres-runtime.stub.ts',
        ),
      }),
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
    expect(nuxt.options.app).toMatchObject({
      head: {
        link: expect.arrayContaining([
          expect.objectContaining({ rel: 'icon', href: '/favicon.svg' }),
          expect.objectContaining({ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }),
        ]),
      },
    })
    expect(JSON.stringify(nuxt.options.app)).not.toContain('manifest')
    expect(nuxt.options.runtimeConfig).toMatchObject({
      public: expect.not.objectContaining({ controlPlaneUrl: expect.anything() }),
    })
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/app/composables'))
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/app/utils'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/server'))
    expect(installModule).toHaveBeenCalledWith('@nuxt/ui')
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
  })
})
