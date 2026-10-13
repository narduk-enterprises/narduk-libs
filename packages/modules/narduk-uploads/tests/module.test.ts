import { beforeEach, describe, expect, it, vi } from 'vitest'

const addServerHandler = vi.hoisted(() => vi.fn())
const addServerImportsDir = vi.hoisted(() => vi.fn())
const addImportsDir = vi.hoisted(() => vi.fn())

vi.mock('@nuxt/kit', () => ({
  addImportsDir,
  addServerHandler,
  addServerImportsDir,
  createResolver: () => ({ resolve: (path: string) => path }),
  defineNuxtModule: (definition: unknown) => definition,
}))

interface ModuleDefinition {
  defaults: Record<string, unknown>
  setup: (options: Record<string, unknown>, nuxt: unknown) => void
}

async function setup(options: Record<string, unknown>) {
  const definition = (await import('../src/module')).default as unknown as ModuleDefinition
  const nuxt = { options: { build: { transpile: [] as string[] }, runtimeConfig: {} } }
  definition.setup({ ...definition.defaults, ...options }, nuxt)
  return nuxt.options
}

function routes() {
  return addServerHandler.mock.calls.map(([handler]) => `${handler.method} ${handler.route}`)
}

describe('narduk-uploads module', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('registers the upload and image routes by default, on the same paths a scan gave', async () => {
    const options = await setup({})

    expect(routes()).toEqual(['post /api/upload', 'get /images/**:slug', 'head /images/**:slug'])
    expect(addServerImportsDir).toHaveBeenCalledWith('../runtime/server/utils')
    expect(options.runtimeConfig).toMatchObject({
      nardukUploads: { imagesBinding: 'BUCKET', imagePrefixes: [] },
    })
  })

  it('leaves the upload route out when uploadRoute is false', async () => {
    await setup({ uploadRoute: false })

    expect(routes()).toEqual(['get /images/**:slug', 'head /images/**:slug'])
  })

  it('passes the image binding and prefixes to the runtime', async () => {
    const prefixes = [
      { prefix: 'v1/', cacheControl: 'public, max-age=60', typeFromExtension: true },
    ]
    const options = await setup({ images: { binding: 'IMAGES', prefixes } })

    expect(options.runtimeConfig).toMatchObject({
      nardukUploads: { imagesBinding: 'IMAGES', imagePrefixes: prefixes },
    })
  })

  it('rejects a prefix that would serve the whole bucket', async () => {
    await expect(
      setup({ images: { prefixes: [{ prefix: '', cacheControl: 'public, max-age=60' }] } }),
    ).rejects.toThrow(/prefix/)
  })

  it('registers nothing on the server when server is false', async () => {
    await setup({ server: false })

    expect(addServerHandler).not.toHaveBeenCalled()
    expect(addServerImportsDir).not.toHaveBeenCalled()
  })
})
