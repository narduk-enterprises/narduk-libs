import { beforeEach, describe, expect, it, vi } from 'vitest'

function mockNuxtKit(hasNuxtModuleImpl: (name: string) => boolean) {
  const addComponentsDir = vi.fn()
  const addImportsDir = vi.fn()
  const addPlugin = vi.fn()
  const addServerScanDir = vi.fn()
  const hasNuxtModule = vi.fn(hasNuxtModuleImpl)
  const installModule = vi.fn().mockResolvedValue(undefined)

  vi.doMock('@nuxt/kit', () => ({
    addComponentsDir,
    addImportsDir,
    addPlugin,
    addServerScanDir,
    createResolver: (url: string) => ({
      resolve: (path: string) => new URL(path, url).pathname,
    }),
    defineNuxtModule: (definition: unknown) => definition,
    hasNuxtModule,
    installModule,
  }))

  return {
    addComponentsDir,
    addImportsDir,
    addPlugin,
    addServerScanDir,
    hasNuxtModule,
    installModule,
  }
}

function makeNuxt() {
  return {
    options: {
      build: { transpile: [] },
      modules: [],
      runtimeConfig: {},
    },
    hook: vi.fn(),
  }
}

describe('narduk-analytics module', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('registers analytics surface without Nuxt layer inheritance', async () => {
    const { addImportsDir, addPlugin, addServerScanDir } = mockNuxtKit(() => true)

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()

    await mod.setup({ app: true, server: true }, nuxt)

    expect(nuxt.options.build.transpile).toContain('@narduk-enterprises/narduk-analytics')
    expect(addImportsDir).toHaveBeenCalledWith(expect.stringContaining('/app/composables'))
    expect(addPlugin).toHaveBeenCalledWith(expect.stringContaining('/app/plugins/posthog.client'))
    expect(addServerScanDir).toHaveBeenCalledWith(expect.stringContaining('/server'))
  })

  it('auto-installs narduk-core when it is not already present', async () => {
    const { hasNuxtModule, installModule } = mockNuxtKit(() => false)

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()

    await mod.setup({ app: true, server: true }, nuxt)

    expect(hasNuxtModule).toHaveBeenCalledWith('@narduk-enterprises/narduk-core', nuxt)
    expect(installModule).toHaveBeenCalledWith('@narduk-enterprises/narduk-core')
  })

  it('does not double-install narduk-core when the app already lists it', async () => {
    const { hasNuxtModule, installModule } = mockNuxtKit(
      (name) => name === '@narduk-enterprises/narduk-core',
    )

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()

    await mod.setup({ app: true, server: true }, nuxt)

    expect(hasNuxtModule).toHaveBeenCalledWith('@narduk-enterprises/narduk-core', nuxt)
    expect(installModule).not.toHaveBeenCalled()
  })

  it('does not double-install narduk-core when the app lists the /nuxt subpath', async () => {
    const { installModule } = mockNuxtKit((name) => name === '@narduk-enterprises/narduk-core/nuxt')

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()

    await mod.setup({ app: true, server: true }, nuxt)

    expect(installModule).not.toHaveBeenCalled()
  })

  it('seeds public analytics keys from NUXT_PUBLIC_* aliases when short names are unset', async () => {
    const previousGa = process.env.GA_MEASUREMENT_ID
    const previousGaAlias = process.env.NUXT_PUBLIC_GA_MEASUREMENT_ID
    const previousPosthog = process.env.POSTHOG_PUBLIC_KEY
    const previousPosthogAlias = process.env.NUXT_PUBLIC_POSTHOG_PUBLIC_KEY
    const previousHost = process.env.POSTHOG_HOST
    const previousHostAlias = process.env.NUXT_PUBLIC_POSTHOG_HOST
    try {
      delete process.env.GA_MEASUREMENT_ID
      delete process.env.POSTHOG_PUBLIC_KEY
      delete process.env.POSTHOG_HOST
      process.env.NUXT_PUBLIC_GA_MEASUREMENT_ID = ' G-ALIAS '
      process.env.NUXT_PUBLIC_POSTHOG_PUBLIC_KEY = ' phc_alias '
      process.env.NUXT_PUBLIC_POSTHOG_HOST = ' https://p.example '
      mockNuxtKit(() => true)
      const mod = (await import('../src/module')).default as unknown as {
        setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
      }
      const nuxt = makeNuxt()
      await mod.setup({ app: false, server: false }, nuxt)
      expect(nuxt.options.runtimeConfig.public).toMatchObject({
        gaMeasurementId: 'G-ALIAS',
        posthogPublicKey: 'phc_alias',
        posthogHost: 'https://p.example',
      })
    } finally {
      if (previousGa === undefined) delete process.env.GA_MEASUREMENT_ID
      else process.env.GA_MEASUREMENT_ID = previousGa
      if (previousGaAlias === undefined) delete process.env.NUXT_PUBLIC_GA_MEASUREMENT_ID
      else process.env.NUXT_PUBLIC_GA_MEASUREMENT_ID = previousGaAlias
      if (previousPosthog === undefined) delete process.env.POSTHOG_PUBLIC_KEY
      else process.env.POSTHOG_PUBLIC_KEY = previousPosthog
      if (previousPosthogAlias === undefined) delete process.env.NUXT_PUBLIC_POSTHOG_PUBLIC_KEY
      else process.env.NUXT_PUBLIC_POSTHOG_PUBLIC_KEY = previousPosthogAlias
      if (previousHost === undefined) delete process.env.POSTHOG_HOST
      else process.env.POSTHOG_HOST = previousHost
      if (previousHostAlias === undefined) delete process.env.NUXT_PUBLIC_POSTHOG_HOST
      else process.env.NUXT_PUBLIC_POSTHOG_HOST = previousHostAlias
    }
  })

  it('keeps session replay off by default while preserving explicit build opt-in', async () => {
    const previous = process.env.POSTHOG_SESSION_REPLAY_ENABLED
    try {
      delete process.env.POSTHOG_SESSION_REPLAY_ENABLED
      mockNuxtKit(() => true)
      let mod = (await import('../src/module')).default as unknown as {
        setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
      }
      let nuxt = makeNuxt()
      await mod.setup({ app: false, server: false }, nuxt)
      expect(nuxt.options.runtimeConfig.public.posthogSessionReplayEnabled).toBe(false)

      vi.resetModules()
      process.env.POSTHOG_SESSION_REPLAY_ENABLED = 'false'
      mockNuxtKit(() => true)
      mod = (await import('../src/module')).default as unknown as {
        setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
      }
      nuxt = makeNuxt()
      await mod.setup({ app: false, server: false }, nuxt)
      expect(nuxt.options.runtimeConfig.public.posthogSessionReplayEnabled).toBe(false)

      vi.resetModules()
      process.env.POSTHOG_SESSION_REPLAY_ENABLED = 'true'
      mockNuxtKit(() => true)
      mod = (await import('../src/module')).default as unknown as {
        setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
      }
      nuxt = makeNuxt()
      await mod.setup({ app: false, server: false }, nuxt)
      expect(nuxt.options.runtimeConfig.public.posthogSessionReplayEnabled).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.POSTHOG_SESSION_REPLAY_ENABLED
      else process.env.POSTHOG_SESSION_REPLAY_ENABLED = previous
    }
  })
})
