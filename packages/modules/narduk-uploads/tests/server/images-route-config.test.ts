import { beforeEach, describe, expect, it, vi } from 'vitest'

// The configurable half of GET/HEAD /images/** (narduk-libs#1828): binding,
// served prefixes with their cache policy, extension-derived types, HEAD from
// metadata, and If-None-Match. The allow-list half lives in images-route.test.ts.

const get = vi.hoisted(() => vi.fn())
const head = vi.hoisted(() => vi.fn())
const useR2 = vi.hoisted(() => vi.fn(() => ({ get, head })))
const getRouterParam = vi.hoisted(() => vi.fn(() => VARIANT_KEY))
const getRequestHeader = vi.hoisted(() => vi.fn((): string | undefined => undefined))
const setResponseHeaders = vi.hoisted(() => vi.fn())
const setResponseStatus = vi.hoisted(() => vi.fn())
const runtimeConfig = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('h3', () => ({
  createError: (input: { message?: string; statusCode?: number }) =>
    Object.assign(new Error(input.message), input),
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader,
  getRouterParam,
  setResponseHeaders,
  setResponseStatus,
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => runtimeConfig.value,
}))

vi.mock('@narduk-enterprises/narduk-uploads/runtime/server/utils/r2', () => ({ useR2 }))

vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => createLogger(),
}))

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }
  return logger
}

async function loadRoute() {
  return import('../../runtime/server/routes/images/[...slug].get')
}

const AVIF = 'image/avif'
const VARIANT_KEY = 'v1/products/a/0-640.avif'
const IMMUTABLE = 'public, max-age=31536000, immutable'
const SHORT = 'public, max-age=3600, stale-while-revalidate=86400'

const CATALOG = {
  nardukUploads: {
    imagesBinding: 'IMAGES',
    imagePrefixes: [
      { prefix: 'v1/', cacheControl: IMMUTABLE, typeFromExtension: true },
      { prefix: 'products/', cacheControl: SHORT, typeFromExtension: true },
    ],
  },
}

function r2Object(contentType: string | undefined, body = 'image body') {
  return {
    body,
    httpEtag: '"etag-1"',
    size: 42,
    ...(contentType === undefined ? {} : { httpMetadata: { contentType } }),
  }
}

describe('configured image serving', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    runtimeConfig.value = CATALOG
    getRouterParam.mockReturnValue(VARIANT_KEY)
    getRequestHeader.mockReturnValue(undefined)
  })

  it('reads the configured binding', async () => {
    get.mockResolvedValue(r2Object(AVIF))
    const route = await loadRoute()

    await route.default({} as never)
    expect(useR2).toHaveBeenCalledWith(expect.anything(), 'IMAGES')
  })

  it("applies the matching prefix's cache policy", async () => {
    get.mockResolvedValue(r2Object(AVIF))
    const route = await loadRoute()
    await expect(route.default({} as never)).resolves.toBe('image body')
    expect(setResponseHeaders).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ 'Cache-Control': IMMUTABLE, 'Content-Length': '42' }),
    )

    getRouterParam.mockReturnValue('products/a/0.jpg')
    get.mockResolvedValue(r2Object('image/jpeg'))
    await route.default({} as never)
    expect(setResponseHeaders).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ 'Cache-Control': SHORT, 'Content-Type': 'image/jpeg' }),
    )
  })

  it('404s a key outside every configured prefix, uploads/ included, without reading R2', async () => {
    for (const key of ['uploads/a.png', 'private/a.png']) {
      getRouterParam.mockReturnValue(key)
      const route = await loadRoute()
      await expect(route.default({} as never)).rejects.toMatchObject({ statusCode: 404 })
    }
    expect(get).not.toHaveBeenCalled()
  })

  it('derives the type from an allow-listed extension when the prefix opts in', async () => {
    get.mockResolvedValue(r2Object(undefined))
    const route = await loadRoute()

    await expect(route.default({} as never)).resolves.toBe('image body')
    expect(setResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'Content-Type': AVIF,
        'X-Content-Type-Options': 'nosniff',
      }),
    )
  })

  it('still refuses SVG with an opted-in prefix, whatever the stored type says', async () => {
    getRouterParam.mockReturnValue('products/a/logo.svg')
    for (const stored of ['image/svg+xml', undefined]) {
      get.mockResolvedValue(r2Object(stored, 'svg body'))
      const route = await loadRoute()
      await expect(route.default({} as never)).rejects.toMatchObject({ statusCode: 415 })
    }
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('answers HEAD from metadata without reading the body', async () => {
    head.mockResolvedValue(r2Object(AVIF))
    const route = await loadRoute()

    await expect(route.default({ method: 'HEAD' } as never)).resolves.toBeNull()
    expect(head).toHaveBeenCalledWith(VARIANT_KEY)
    expect(get).not.toHaveBeenCalled()
    expect(setResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'Content-Length': '42', ETag: '"etag-1"' }),
    )
  })

  it('answers a matching If-None-Match with 304 and no body', async () => {
    get.mockResolvedValue(r2Object(AVIF))
    getRequestHeader.mockReturnValue('"other", "etag-1"')
    const route = await loadRoute()

    await expect(route.default({} as never)).resolves.toBeNull()
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 304)
  })

  it('keeps the uploads/ default when nothing is configured', async () => {
    runtimeConfig.value = {}
    getRouterParam.mockReturnValue('uploads/a.png')
    get.mockResolvedValue(r2Object('image/png'))
    const route = await loadRoute()

    await expect(route.default({} as never)).resolves.toBe('image body')
    expect(useR2).toHaveBeenCalledWith(expect.anything(), 'BUCKET')
    expect(setResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'Cache-Control': IMMUTABLE }),
    )
  })

  it('does not derive a type from the extension unless the prefix opts in', async () => {
    runtimeConfig.value = {}
    getRouterParam.mockReturnValue('uploads/a.png')
    get.mockResolvedValue(r2Object(undefined))
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({ statusCode: 415 })
  })
})
