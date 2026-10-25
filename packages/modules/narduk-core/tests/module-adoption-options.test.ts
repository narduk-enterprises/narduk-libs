/**
 * The opt-outs an existing app needs to adopt narduk-core mid-life
 * (narduk-libs#1940, #1953): `postgresSchema`, `csrf.enabled`, `health`.
 * Every one defaults to what the module did before.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface TemplateArg {
  filename: string
  getContents: () => string
  write?: boolean
}

async function loadCoreModule() {
  vi.resetModules()
  const hooks = new Map<string, Array<(value: never) => void>>()
  const templates: TemplateArg[] = []
  vi.doMock('@nuxt/kit', () => ({
    addComponentsDir: vi.fn(),
    addImportsDir: vi.fn(),
    addPlugin: vi.fn(),
    addServerHandler: vi.fn(),
    addServerScanDir: vi.fn(),
    addTemplate: vi.fn((template: TemplateArg) => {
      templates.push(template)
      return { filename: template.filename, dst: `/build/${template.filename}` }
    }),
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
      buildDir: '/app/.nuxt',
      colorMode: {},
      css: [],
      devServer: {},
      future: {},
      icon: {},
      nitro: {},
      rootDir: '/app',
      runtimeConfig: {} as Record<string, unknown>,
      ui: {},
      vite: {},
    },
    hook(name: string, handler: (value: never) => void) {
      hooks.set(name, [...(hooks.get(name) || []), handler])
    },
  }
  const setup = (options: Record<string, unknown> = {}) =>
    mod.setup({ app: false, coreModules: false, server: false, ...options }, nuxt)
  return { hooks, nuxt, setup, templates }
}

let previousBackend: string | undefined
beforeEach(() => {
  previousBackend = process.env.NUXT_DATABASE_BACKEND
  delete process.env.NUXT_DATABASE_BACKEND
})
afterEach(() => {
  if (previousBackend === undefined) delete process.env.NUXT_DATABASE_BACKEND
  else process.env.NUXT_DATABASE_BACKEND = previousBackend
})

describe('postgresSchema option (narduk-libs#1953)', () => {
  it('defaults to public and aliases the static module, with no generated file', async () => {
    const { nuxt, setup, templates } = await loadCoreModule()
    await setup({ databaseBackend: 'postgres' })

    expect(nuxt.options.alias['#narduk-core/postgres-schema']).toContain(
      '/runtime/internal/postgres-schema.ts',
    )
    expect(nuxt.options.runtimeConfig.postgresSchema).toBe('public')
    expect(templates).toEqual([])
  })

  it('aliases a generated file that exports the named schema', async () => {
    const { nuxt, setup, templates } = await loadCoreModule()
    await setup({ databaseBackend: 'postgres', postgresSchema: 'narduk' })

    expect(nuxt.options.alias['#narduk-core/postgres-schema']).toBe(
      '/build/narduk-core/postgres-schema.ts',
    )
    expect(templates).toHaveLength(1)
    expect(templates[0]?.write).toBe(true)
    expect(templates[0]?.getContents()).toBe('export const postgresSchema: string = "narduk"\n')
    expect(nuxt.options.runtimeConfig.postgresSchema).toBe('narduk')
    expect(nuxt.options.alias['#narduk-core/schema']).toContain('/pg-schema.ts')
  })

  it('also takes the backend from NUXT_DATABASE_BACKEND', async () => {
    process.env.NUXT_DATABASE_BACKEND = 'postgres'
    const { nuxt, setup } = await loadCoreModule()
    await setup({ postgresSchema: 'narduk' })
    expect(nuxt.options.runtimeConfig.postgresSchema).toBe('narduk')
  })

  it.each([
    'Narduk',
    'a-b',
    'a"b; DROP SCHEMA public',
    'pg_catalog',
    'a.b',
    '1abc',
    '',
    'x'.repeat(64),
  ])('rejects the schema name %j at build time', async (postgresSchema) => {
    const { setup } = await loadCoreModule()
    await expect(setup({ databaseBackend: 'postgres', postgresSchema })).rejects.toThrow(
      'nardukCore.postgresSchema',
    )
  })

  it.each(['d1', 'none'])(
    'fails the build rather than ignoring a named schema on the %s backend',
    async (databaseBackend) => {
      const { setup } = await loadCoreModule()
      await expect(setup({ databaseBackend, postgresSchema: 'narduk' })).rejects.toThrow(
        "only applies to databaseBackend 'postgres'",
      )
    },
  )

  it('accepts an explicit public on any backend', async () => {
    const { nuxt, setup } = await loadCoreModule()
    await setup({ databaseBackend: 'd1', postgresSchema: 'public' })
    expect(nuxt.options.runtimeConfig.postgresSchema).toBe('public')
  })
})

describe('csrf.enabled option (narduk-libs#1940)', () => {
  it('is on by default and when the option is omitted', async () => {
    const { nuxt, setup } = await loadCoreModule()
    await setup()
    expect(nuxt.options.runtimeConfig.nardukCsrf).toEqual({ enabled: true, exemptPaths: [] })
  })

  it('records an explicit off next to the exemptions', async () => {
    const { nuxt, setup } = await loadCoreModule()
    await setup({ csrf: { enabled: false, exemptPaths: ['/api/devices/*'] } })
    expect(nuxt.options.runtimeConfig.nardukCsrf).toEqual({
      enabled: false,
      exemptPaths: ['/api/devices/*'],
    })
  })

  it('keeps an earlier runtime value across a repeated setup', async () => {
    const { nuxt, setup } = await loadCoreModule()
    await setup({ csrf: { enabled: false } })
    await setup()
    expect(nuxt.options.runtimeConfig.nardukCsrf).toMatchObject({ enabled: false })
  })
})

describe('health option (narduk-libs#1940): the layer route in a real Nitro scan', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'narduk-health-'))
    // The collision stonx hit: the app's own route is a `server/routes/` file,
    // which Nitro scans after `server/api/`, so the layer's file would win.
    mkdirSync(join(root, 'server/routes/api'), { recursive: true })
    writeFileSync(
      join(root, 'server/routes/api/health.get.ts'),
      'export default defineEventHandler(() => ({ buildSha: "abc" }))\n',
    )
  })
  afterEach(() => {
    rmSync(root, { force: true, recursive: true })
  })

  async function scan(options: Record<string, unknown>) {
    const { hooks, setup } = await loadCoreModule()
    await setup({ server: true, ...options })
    const config: { ignore?: string[]; typescript?: unknown } = {}
    for (const hook of hooks.get('nitro:config') ?? []) hook(config as never)
    const { createNitro } = await import('nitropack/core')
    const layerServer = new URL('../runtime/server', import.meta.url).pathname
    const nitro = await createNitro({
      rootDir: root,
      srcDir: join(root, 'server'),
      buildDir: join(root, '.nitro-build'),
      scanDirs: [join(root, 'server'), layerServer],
      ignore: config.ignore,
      dev: false,
      preset: 'node-server',
      imports: false,
    })
    const handlers = nitro.scannedHandlers.filter(
      (handler) => handler.route === '/api/health' && handler.method === 'get',
    )
    await nitro.close()
    return { config, handlers: handlers.map((handler) => handler.handler) }
  }

  it("serves the layer's /api/health by default, shadowing an app route under server/routes", async () => {
    const { config, handlers } = await scan({})
    expect(config.ignore).toBeUndefined()
    expect(handlers).toHaveLength(1)
    expect(handlers[0]).toContain('/runtime/server/api/health.get.ts')
  })

  it("health: false leaves the app's own route as the only /api/health", async () => {
    const { config, handlers } = await scan({ health: false })
    expect(config.ignore).toHaveLength(1)
    expect(handlers).toEqual([join(root, 'server/routes/api/health.get.ts')])
  })

  it('health: false ignores only the layer file, never an app file of the same relative name', async () => {
    mkdirSync(join(root, 'server/api'), { recursive: true })
    writeFileSync(
      join(root, 'server/api/health.get.ts'),
      'export default defineEventHandler(() => ({ ok: true }))\n',
    )
    const { handlers } = await scan({ health: false })
    expect(handlers).toEqual([join(root, 'server/api/health.get.ts')])
  })

  it('health: false registers nothing when the server layer is off', async () => {
    const { config } = await scan({ health: false, server: false })
    expect(config.ignore).toBeUndefined()
  })
})
