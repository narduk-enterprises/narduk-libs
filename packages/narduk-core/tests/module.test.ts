import { describe, expect, it, vi } from 'vitest'

describe('narduk-core module', () => {
  it('registers core aliases without relying on Nuxt layer inheritance', async () => {
    const installModule = vi.fn()
    const addImportsDir = vi.fn()
    const addComponentsDir = vi.fn()
    const addPlugin = vi.fn()
    const addLayout = vi.fn()
    const addServerScanDir = vi.fn()
    const hooks = new Map<string, Array<(value: never) => void>>()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir,
      addImportsDir,
      addLayout,
      addPlugin,
      addServerScanDir,
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule,
    }))
    vi.doMock('@narduk-enterprises/narduk-platform', () => ({
      readProvisionMetadata: () => ({}),
      resolveLocalNuxtPort: () => 3000,
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
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/app/composables'))
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/app/utils'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/runtime/server'))
    expect(installModule).toHaveBeenCalledWith('@nuxt/ui')
    expect(hooks.has('vite:extendConfig')).toBe(true)
  })
})
