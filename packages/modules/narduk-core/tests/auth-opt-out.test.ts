/**
 * narduk-libs#169: `nardukCore.auth: false` must skip `nuxt-auth-utils` and
 * must not seed an empty `runtimeConfig.session.password`. The merged
 * `loadStrategy: 'none'` path still installs the module and still registers
 * `/api/_auth/session`; that is not enough for a site with no accounts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function restoreEnv(previous: {
  NUXT_SESSION_PASSWORD: string | undefined
  SESSION_PASSWORD: string | undefined
}): void {
  if (previous.NUXT_SESSION_PASSWORD === undefined) delete process.env.NUXT_SESSION_PASSWORD
  else process.env.NUXT_SESSION_PASSWORD = previous.NUXT_SESSION_PASSWORD
  if (previous.SESSION_PASSWORD === undefined) delete process.env.SESSION_PASSWORD
  else process.env.SESSION_PASSWORD = previous.SESSION_PASSWORD
}

async function loadCoreModule(
  nuxtOptions: {
    auth?: { loadStrategy?: unknown }
    modules?: unknown[]
    runtimeConfig?: Record<string, unknown>
  } = {},
) {
  const installModule = vi.fn()
  vi.resetModules()
  vi.doMock('@nuxt/kit', () => ({
    addComponentsDir: vi.fn(),
    addImportsDir: vi.fn(),
    addPlugin: vi.fn(),
    addServerHandler: vi.fn(),
    addServerScanDir: vi.fn(),
    addTemplate: vi.fn((template: { src: string }) => ({
      filename: template.src.split('/').pop(),
    })),
    createResolver: (url: string) => ({
      resolve: (path: string) => new URL(path, url).pathname,
    }),
    defineNuxtModule: (definition: unknown) => definition,
    installModule,
  }))
  const mod = (await import('../src/module')).default as unknown as {
    defaults: { auth?: boolean }
    setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
  }
  const nuxt = {
    options: {
      alias: {},
      app: {},
      appConfig: {},
      auth: nuxtOptions.auth,
      build: { transpile: [] },
      colorMode: {},
      css: [],
      devServer: {},
      future: {},
      icon: {},
      modules: nuxtOptions.modules ?? ['../../../src/module'],
      nitro: {},
      runtimeConfig: nuxtOptions.runtimeConfig ?? {},
      ui: {},
      vite: {},
    },
    hook() {},
  }
  return { installModule, mod, nuxt }
}

function installedAuthUtils(installModule: ReturnType<typeof vi.fn>): boolean {
  return installModule.mock.calls.some((entry) => entry[0] === 'nuxt-auth-utils')
}

describe('nardukCore.auth opt-out (narduk-libs#169)', () => {
  let previous: {
    NUXT_SESSION_PASSWORD: string | undefined
    SESSION_PASSWORD: string | undefined
  } = {
    NUXT_SESSION_PASSWORD: undefined,
    SESSION_PASSWORD: undefined,
  }

  beforeEach(() => {
    previous = {
      NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD,
      SESSION_PASSWORD: process.env.SESSION_PASSWORD,
    }
    delete process.env.NUXT_SESSION_PASSWORD
    delete process.env.SESSION_PASSWORD
  })

  afterEach(() => {
    restoreEnv(previous)
  })

  it("defaults auth to true so existing apps keep today's install", async () => {
    const { mod } = await loadCoreModule()
    expect(mod.defaults.auth).toBe(true)
  })

  it('still installs nuxt-auth-utils when auth is omitted', async () => {
    const { installModule, mod, nuxt } = await loadCoreModule()
    await mod.setup({ app: false, coreModules: true, image: false, server: false }, nuxt)

    expect(installedAuthUtils(installModule)).toBe(true)
    expect(installModule).toHaveBeenCalledWith('@nuxt/ui')
    expect(nuxt.options.runtimeConfig).toMatchObject({ session: { password: '' } })
  })

  it('still installs nuxt-auth-utils when auth is true', async () => {
    const { installModule, mod, nuxt } = await loadCoreModule()
    await mod.setup(
      { app: false, auth: true, coreModules: true, image: false, server: false },
      nuxt,
    )

    expect(installedAuthUtils(installModule)).toBe(true)
    expect(nuxt.options.runtimeConfig).toMatchObject({ session: { password: '' } })
  })

  it('does not install nuxt-auth-utils when auth is false', async () => {
    const { installModule, mod, nuxt } = await loadCoreModule()
    await mod.setup(
      { app: false, auth: false, coreModules: true, image: false, server: false },
      nuxt,
    )

    expect(installedAuthUtils(installModule)).toBe(false)
    expect(installModule).toHaveBeenCalledWith('@nuxt/ui')
    expect(installModule).toHaveBeenCalledWith('@pinia/nuxt')
  })

  it('does not seed an empty session password when auth is false', async () => {
    const { mod, nuxt } = await loadCoreModule()
    await mod.setup(
      { app: false, auth: false, coreModules: true, image: false, server: false },
      nuxt,
    )

    expect(nuxt.options.runtimeConfig.session).toBeUndefined()
  })

  it('leaves an app-owned session password alone when auth is false', async () => {
    const { installModule, mod, nuxt } = await loadCoreModule({
      runtimeConfig: { session: { password: 'app-owned-session-password' } },
    })
    await mod.setup(
      { app: false, auth: false, coreModules: true, image: false, server: false },
      nuxt,
    )

    expect(installedAuthUtils(installModule)).toBe(false)
    expect(nuxt.options.runtimeConfig).toMatchObject({
      session: { password: 'app-owned-session-password' },
    })
  })

  it('does not install nuxt-auth-utils when auth is false even if a session password is set', async () => {
    process.env.NUXT_SESSION_PASSWORD = 'test-session-password-must-be-at-least-32-chars'
    const { installModule, mod, nuxt } = await loadCoreModule()
    await mod.setup(
      { app: false, auth: false, coreModules: true, image: false, server: false },
      nuxt,
    )

    expect(installedAuthUtils(installModule)).toBe(false)
    expect(nuxt.options.runtimeConfig.session).toBeUndefined()
  })
})
