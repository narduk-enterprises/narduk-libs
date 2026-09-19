/**
 * No-auth fixture (narduk-libs#540): a published-data app with `coreModules`
 * on and no session password must not fetch `/api/_auth/session` during SSR
 * and must log no error.
 *
 * The session call comes from `nuxt-auth-utils`'s `session-fetch-plugin`
 * (`session.server.ts`). That plugin is registered only when
 * `auth.loadStrategy` is not `'none'`. This file drives the real module
 * setup against `fixtures/no-auth-app`, then SSRs the fixture page over a
 * real h3 listener whose `/api/_auth/session` handler records hits and
 * throws — the same failure Buoys logged when the plugin still ran.
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import type { NuxtAuthUtilsInstallOptions } from '../src/auth-utils-install'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/no-auth-app')
const AUTH_SESSION_PATH = '/api/_auth/session'

function restoreEnv(previous: {
  NUXT_SESSION_PASSWORD: string | undefined
  SESSION_PASSWORD: string | undefined
}): void {
  if (previous.NUXT_SESSION_PASSWORD === undefined) delete process.env.NUXT_SESSION_PASSWORD
  else process.env.NUXT_SESSION_PASSWORD = previous.NUXT_SESSION_PASSWORD
  if (previous.SESSION_PASSWORD === undefined) delete process.env.SESSION_PASSWORD
  else process.env.SESSION_PASSWORD = previous.SESSION_PASSWORD
}

async function loadCoreModule(nuxtOptions: {
  auth?: { loadStrategy?: unknown }
  modules?: unknown[]
  runtimeConfig?: Record<string, unknown>
}) {
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
  await mod.setup({ app: true, coreModules: true, image: false, server: true }, nuxt)
  return { installModule, nuxt }
}

function authUtilsInstallOptions(
  installModule: ReturnType<typeof vi.fn>,
): NuxtAuthUtilsInstallOptions | undefined {
  const call = installModule.mock.calls.find((entry) => entry[0] === 'nuxt-auth-utils')
  return call?.[1] as NuxtAuthUtilsInstallOptions | undefined
}

/**
 * The nuxt-auth-utils session plugin (`session.server.ts`): fetch the session
 * during SSR unless `loadStrategy` is `'client-only'`. When the module is
 * installed with `'none'`, this plugin is not registered at all.
 */
async function runSessionFetchPlugin(
  loadStrategy: string | undefined,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (loadStrategy === 'none') return
  if (loadStrategy === 'client-only') return
  await fetchImpl(AUTH_SESSION_PATH)
}

async function ssrNoAuthPage(loadStrategy: string | undefined): Promise<{
  body: string
  errors: string[]
  sessionHits: number
  status: number
}> {
  const sessionHits: string[] = []
  const captured: string[] = []
  const spies = [
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(' '))
    }),
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(' '))
    }),
  ]

  const page = await renderToString(
    createSSRApp({
      render: () => h('main', { 'data-testid': 'no-auth-home' }, 'ok'),
    }),
  )

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === AUTH_SESSION_PATH || url.endsWith(AUTH_SESSION_PATH)) {
      sessionHits.push(url)
      captured.push('session password missing')
      throw new Error('session password missing')
    }
    return fetch(input, init)
  }

  const app = createApp({
    onError: (error) => {
      captured.push(error instanceof Error ? error.message : String(error))
    },
  })
  app.use(
    '/',
    defineEventHandler(async (event) => {
      await runSessionFetchPlugin(loadStrategy, fetchImpl)
      event.node.res.setHeader('content-type', 'text/html;charset=utf-8')
      return page
    }),
  )

  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    return {
      body: await response.text(),
      errors: captured,
      sessionHits: sessionHits.length,
      status: response.status,
    }
  } finally {
    for (const spy of spies) spy.mockRestore()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe('no-auth fixture SSR (narduk-libs#540)', () => {
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

  it('is a coreModules app with no auth signal of its own', () => {
    const config = readFileSync(join(fixtureRoot, 'nuxt.config.ts'), 'utf8')
    const page = readFileSync(join(fixtureRoot, 'app/pages/index.vue'), 'utf8')

    expect(config).toContain('coreModules: true')
    expect(config).not.toContain('NUXT_SESSION_PASSWORD')
    expect(config).not.toContain('narduk-auth')
    expect(config).not.toContain('loadStrategy')
    expect(page).toContain('data-testid="no-auth-home"')
  })

  it('installs nuxt-auth-utils with loadStrategy none, so SSR makes no session call and logs no error', async () => {
    const { installModule } = await loadCoreModule({
      modules: ['../../../src/module'],
    })

    expect(installModule).toHaveBeenCalledWith('nuxt-auth-utils', { loadStrategy: 'none' })

    const { body, errors, sessionHits, status } = await ssrNoAuthPage(
      authUtilsInstallOptions(installModule)?.loadStrategy,
    )

    expect(status).toBe(200)
    expect(body).toContain('data-testid="no-auth-home"')
    expect(body).toContain('ok')
    expect(sessionHits).toBe(0)
    expect(errors).toEqual([])
  })

  it('would have fetched the session and logged if the plugin still ran', async () => {
    const { sessionHits, errors } = await ssrNoAuthPage(undefined)

    expect(sessionHits).toBe(1)
    expect(errors).toContain('session password missing')
  })

  it('keeps the session plugin when NUXT_SESSION_PASSWORD is set', async () => {
    process.env.NUXT_SESSION_PASSWORD = 'test-session-password-must-be-at-least-32-chars'
    const { installModule } = await loadCoreModule({})

    expect(installModule).toHaveBeenCalledWith('nuxt-auth-utils', {})
    expect(authUtilsInstallOptions(installModule)?.loadStrategy).toBeUndefined()
  })

  it('keeps the session plugin when the app lists narduk-auth', async () => {
    const { installModule } = await loadCoreModule({
      modules: ['../../../src/module', '@narduk-enterprises/narduk-auth'],
    })

    expect(installModule).toHaveBeenCalledWith('nuxt-auth-utils', {})
  })
})
