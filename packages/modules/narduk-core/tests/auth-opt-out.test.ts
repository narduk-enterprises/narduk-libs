/**
 * narduk-libs#169: `nardukCore.auth: false` must skip `nuxt-auth-utils` and
 * must not seed an empty `runtimeConfig.session.password`. The merged
 * `loadStrategy: 'none'` path still installs the module and still registers
 * `/api/_auth/session`; that is not enough for a site with no accounts.
 *
 * With `app` on, core's dashboard layout still calls `useUserSession`, so auth
 * off registers a signed-out stub under that name; and narduk-auth, which
 * relies on core installing `nuxt-auth-utils`, refuses to build with auth off.
 */
import { existsSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useUserSession as useSignedOutUserSession } from '../runtime/app/session/useUserSessionStub'

type HookHandler = (...args: unknown[]) => unknown
interface AutoImport {
  as?: string
  from: string
  name: string
}

const CORE_MODULE = '../../../src/module'
const NARDUK_AUTH = '@narduk-enterprises/narduk-auth'
const MODULES_DONE = 'modules:done'

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
    _installedModules?: Array<{ meta?: { name?: unknown } }>
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
  const hooks = new Map<string, HookHandler[]>()
  const nuxt = {
    options: {
      _installedModules: nuxtOptions._installedModules ?? [],
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
      modules: nuxtOptions.modules ?? [CORE_MODULE],
      nitro: {},
      runtimeConfig: nuxtOptions.runtimeConfig ?? {},
      ui: {},
      vite: {},
    },
    hook(name: string, handler: HookHandler) {
      hooks.set(name, [...(hooks.get(name) ?? []), handler])
    },
  }
  async function callHook(name: string, ...args: unknown[]): Promise<void> {
    for (const handler of hooks.get(name) ?? []) await handler(...args)
  }
  /** The auto-imports after `imports:extend`, starting from `existing`. */
  async function extendImports(existing: AutoImport[] = []): Promise<AutoImport[]> {
    const imports = [...existing]
    await callHook('imports:extend', imports)
    return imports
  }
  return { callHook, extendImports, installModule, mod, nuxt }
}

const APP_AUTH_OFF = { app: true, auth: false, coreModules: true, image: false, server: false }

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

describe('useUserSession with nardukCore.auth: false and app on (narduk-libs#169)', () => {
  function userSessionImports(imports: AutoImport[]): AutoImport[] {
    return imports.filter((entry) => (entry.as ?? entry.name) === 'useUserSession')
  }

  it('registers the signed-out stub so the dashboard layout still resolves it', async () => {
    const { extendImports, installModule, mod, nuxt } = await loadCoreModule()
    await mod.setup(APP_AUTH_OFF, nuxt)

    expect(installedAuthUtils(installModule)).toBe(false)
    const [entry, ...rest] = userSessionImports(await extendImports())
    expect(rest).toEqual([])
    expect(entry?.from).toMatch(/runtime\/app\/session\/useUserSessionStub$/)
    expect(existsSync(`${entry?.from}.ts`)).toBe(true)
  })

  it('registers nothing when auth stays on: nuxt-auth-utils provides it', async () => {
    const { extendImports, installModule, mod, nuxt } = await loadCoreModule()
    await mod.setup({ ...APP_AUTH_OFF, auth: true }, nuxt)

    expect(installedAuthUtils(installModule)).toBe(true)
    expect(userSessionImports(await extendImports())).toEqual([])
  })

  it('registers nothing when app is off: no dashboard calls it', async () => {
    const { extendImports, mod, nuxt } = await loadCoreModule()
    await mod.setup({ ...APP_AUTH_OFF, app: false }, nuxt)

    expect(userSessionImports(await extendImports())).toEqual([])
  })

  it('keeps the real composable when the app lists nuxt-auth-utils itself', async () => {
    const { extendImports, mod, nuxt } = await loadCoreModule({
      modules: [CORE_MODULE, 'nuxt-auth-utils'],
    })
    await mod.setup(APP_AUTH_OFF, nuxt)

    expect(userSessionImports(await extendImports())).toEqual([])
  })

  it('keeps the real composable when another module installed nuxt-auth-utils', async () => {
    const { extendImports, mod, nuxt } = await loadCoreModule({
      _installedModules: [{ meta: { name: 'auth-utils' } }],
    })
    await mod.setup(APP_AUTH_OFF, nuxt)

    expect(userSessionImports(await extendImports())).toEqual([])
  })

  it('does not add a second useUserSession when one is already registered', async () => {
    const { extendImports, mod, nuxt } = await loadCoreModule()
    await mod.setup(APP_AUTH_OFF, nuxt)

    const existing = { from: '/app/composables/session', name: 'useUserSession' }
    expect(userSessionImports(await extendImports([existing]))).toEqual([existing])
  })

  it('returns the nuxt-auth-utils shape, signed out and ready', async () => {
    const session = useSignedOutUserSession()

    expect(session.ready.value).toBe(true)
    expect(session.loggedIn.value).toBe(false)
    expect(session.user.value).toBeNull()
    expect(session.session.value).toBeNull()
    await expect(session.fetch()).resolves.toBeUndefined()
    await expect(session.clear()).resolves.toBeUndefined()
    expect(session.openInPopup('/auth/github')).toBeUndefined()
  })
})

describe('nardukCore.auth: false with narduk-auth (narduk-libs#169)', () => {
  const CONFLICT = /nardukCore\.auth: false conflicts with @narduk-enterprises\/narduk-auth/

  it('refuses the build when narduk-auth is in modules and nothing installs nuxt-auth-utils', async () => {
    const { callHook, mod, nuxt } = await loadCoreModule({
      modules: [CORE_MODULE, NARDUK_AUTH],
    })
    await mod.setup(APP_AUTH_OFF, nuxt)

    await expect(callHook(MODULES_DONE)).rejects.toThrow(CONFLICT)
  })

  it('refuses the build when narduk-auth was installed by another route', async () => {
    const { callHook, mod, nuxt } = await loadCoreModule()
    await mod.setup({ ...APP_AUTH_OFF, app: false }, nuxt)
    // What narduk-auth's own setup assigns (see database-backend `usesNardukAuth`).
    nuxt.options.runtimeConfig.nardukHealth = { authTables: true }

    await expect(callHook(MODULES_DONE)).rejects.toThrow(CONFLICT)
  })

  it('allows narduk-auth with auth off when the app installs nuxt-auth-utils itself', async () => {
    const { callHook, mod, nuxt } = await loadCoreModule({
      modules: [CORE_MODULE, 'nuxt-auth-utils', NARDUK_AUTH],
    })
    await mod.setup(APP_AUTH_OFF, nuxt)

    await expect(callHook(MODULES_DONE)).resolves.toBeUndefined()
  })

  it('allows narduk-auth when auth stays on', async () => {
    const { callHook, mod, nuxt } = await loadCoreModule({
      modules: [CORE_MODULE, NARDUK_AUTH],
    })
    await mod.setup({ ...APP_AUTH_OFF, auth: true }, nuxt)

    await expect(callHook(MODULES_DONE)).resolves.toBeUndefined()
  })

  it('allows auth off with no narduk-auth', async () => {
    const { callHook, mod, nuxt } = await loadCoreModule()
    await mod.setup(APP_AUTH_OFF, nuxt)

    await expect(callHook(MODULES_DONE)).resolves.toBeUndefined()
  })
})
