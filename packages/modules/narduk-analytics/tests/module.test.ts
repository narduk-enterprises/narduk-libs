import { existsSync, readdirSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const CORE = '@narduk-enterprises/narduk-core'

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

    expect(hasNuxtModule).toHaveBeenCalledWith(CORE, nuxt)
    expect(installModule).toHaveBeenCalledWith(CORE)
  })

  it('does not double-install narduk-core when the app already lists it', async () => {
    const { hasNuxtModule, installModule } = mockNuxtKit((name) => name === CORE)

    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()

    await mod.setup({ app: true, server: true }, nuxt)

    expect(hasNuxtModule).toHaveBeenCalledWith(CORE, nuxt)
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

  it.each([
    ['the nardukCore key', { nardukCore: { app: false, server: true } }],
    ['an inline module tuple', { modules: [[CORE, { app: false, coreModules: false }]] }],
    [
      'the /nuxt subpath tuple',
      { modules: [['@narduk-enterprises/narduk-core/nuxt', { app: false }]] },
    ],
  ])('fails the build when narduk-core is registered with app: false via %s', async (_, shape) => {
    mockNuxtKit(() => true)
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()
    Object.assign(nuxt.options, shape)

    await expect(mod.setup({ app: true, server: true }, nuxt)).rejects.toThrow(
      /app: false.*nardukAnalytics\.app: false/su,
    )
  })

  it('allows core app: false when the analytics client half is off too', async () => {
    const { addPlugin } = mockNuxtKit(() => true)
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()
    Object.assign(nuxt.options, { nardukCore: { app: false } })

    await mod.setup({ app: false, server: true }, nuxt)
    expect(addPlugin).not.toHaveBeenCalled()
  })

  it.each([
    ['no nardukCore key', {}],
    ['a nardukCore key without app', { nardukCore: { server: true } }],
    ['a bare module entry', { modules: [CORE] }],
    ['app: true', { nardukCore: { app: true } }],
  ])("treats %s as narduk-core's default, app on", async (_, shape) => {
    const { addPlugin } = mockNuxtKit(() => true)
    const mod = (await import('../src/module')).default as unknown as {
      setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
    }
    const nuxt = makeNuxt()
    Object.assign(nuxt.options, shape)

    await mod.setup({ app: true, server: true }, nuxt)
    expect(addPlugin).toHaveBeenCalledWith(expect.stringContaining('/app/plugins/posthog.client'))
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

  describe('admin routes on an app with no database (#524)', () => {
    async function scanned(
      options: Record<string, unknown>,
      nuxtOptions: Record<string, unknown> = {},
      env?: string,
    ): Promise<string[]> {
      const previous = process.env.NUXT_DATABASE_BACKEND
      if (env === undefined) delete process.env.NUXT_DATABASE_BACKEND
      else process.env.NUXT_DATABASE_BACKEND = env
      try {
        vi.resetModules()
        const { addServerScanDir } = mockNuxtKit(() => true)
        const mod = (await import('../src/module')).default as unknown as {
          setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
        }
        const nuxt = makeNuxt()
        Object.assign(nuxt.options, nuxtOptions)
        await mod.setup({ app: false, server: true, ...options }, nuxt)
        return addServerScanDir.mock.calls.map(([dir]) =>
          String(dir).replace(/^.*\/(server(?:\/admin)?)$/, '$1'),
        )
      } finally {
        if (previous === undefined) delete process.env.NUXT_DATABASE_BACKEND
        else process.env.NUXT_DATABASE_BACKEND = previous
      }
    }

    it('keeps every admin handler out of the always-scanned server/api tree', () => {
      const root = new URL('../server/', import.meta.url)
      expect(existsSync(new URL('api/admin', root))).toBe(false)
      expect(readdirSync(new URL('admin/api/admin', root), { recursive: true })).toContain(
        'gsc/performance.get.ts',
      )
    })

    it('registers the admin routes by default', async () => {
      expect(await scanned({})).toEqual(['server', 'server/admin'])
      expect(await scanned({}, { nardukCore: { databaseBackend: 'd1' } })).toEqual([
        'server',
        'server/admin',
      ])
    })

    it('leaves them out when the app declares no database, however it declares it', async () => {
      expect(await scanned({}, { nardukCore: { databaseBackend: 'none' } })).toEqual(['server'])
      expect(
        await scanned(
          {},
          { modules: [['@narduk-enterprises/narduk-core/nuxt', { databaseBackend: 'none' }]] },
        ),
      ).toEqual(['server'])
      expect(await scanned({}, {}, 'none')).toEqual(['server'])
    })

    it('lets the config key win over the environment, as narduk-core does', async () => {
      expect(await scanned({}, { nardukCore: { databaseBackend: 'd1' } }, 'none')).toEqual([
        'server',
        'server/admin',
      ])
    })

    it('honours an explicit admin option either way', async () => {
      expect(await scanned({ admin: true }, { nardukCore: { databaseBackend: 'none' } })).toEqual([
        'server',
        'server/admin',
      ])
      expect(await scanned({ admin: false })).toEqual(['server'])
      expect(await scanned({ admin: true, server: false })).toEqual([])
    })
  })
})
