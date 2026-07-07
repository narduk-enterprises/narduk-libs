import { describe, expect, it, vi } from 'vitest'

describe('narduk-analytics module', () => {
  it('registers analytics surface without Nuxt layer inheritance', async () => {
    const addComponentsDir = vi.fn()
    const addImportsDir = vi.fn()
    const addPlugin = vi.fn()
    const addServerScanDir = vi.fn()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir,
      addImportsDir,
      addPlugin,
      addServerScanDir,
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
    }))

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => void
    }
    const nuxt = {
      options: {
        build: { transpile: [] },
        runtimeConfig: {},
      },
      hook: vi.fn(),
    }

    mod.setup({ app: true, server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-analytics')
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(addPlugin).toHaveBeenCalledWith(expect.stringContaining('/app/plugins/posthog.client'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
  })
})
