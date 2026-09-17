import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())
const getRouterParam = vi.hoisted(() => vi.fn(() => 'uploads/test.svg'))
const setResponseHeaders = vi.hoisted(() => vi.fn())

vi.mock('h3', () => ({
  createError: (input: { message?: string; statusCode?: number }) =>
    Object.assign(new Error(input.message), input),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam,
  setResponseHeaders,
}))

vi.mock('@narduk-enterprises/narduk-uploads/runtime/server/utils/r2', () => ({
  useR2: () => ({ get }),
}))

vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => createLogger(),
}))

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    debug: vi.fn(),
    warn: vi.fn(),
  }
  return logger
}

async function loadRoute() {
  return import('../../runtime/server/routes/images/[...slug].get')
}

const UNSUPPORTED_IMAGE_TYPE = 'Unsupported image type'

function r2Object(
  contentType: string | undefined,
  body = 'image body',
): { body: string; httpEtag: string; httpMetadata?: { contentType?: string } } {
  if (contentType === undefined) {
    return { body, httpEtag: 'etag' }
  }
  return { body, httpEtag: 'etag', httpMetadata: { contentType } }
}

describe('uploaded image route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getRouterParam.mockReturnValue('uploads/test.svg')
  })

  it('blocks existing R2 SVG objects from rendering as first-party documents', async () => {
    get.mockResolvedValue(r2Object('image/svg+xml; charset=utf-8', 'svg body'))
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: UNSUPPORTED_IMAGE_TYPE,
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('blocks SVG upload keys even when old R2 metadata is missing or wrong', async () => {
    get.mockResolvedValue(r2Object('application/octet-stream', 'svg body'))
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: UNSUPPORTED_IMAGE_TYPE,
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('returns 415 for stored text/html objects under uploads/', async () => {
    getRouterParam.mockReturnValue('uploads/page.html')
    get.mockResolvedValue(r2Object('text/html', '<script>alert(1)</script>'))
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: UNSUPPORTED_IMAGE_TYPE,
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('returns 415 for stored application/javascript objects under uploads/', async () => {
    getRouterParam.mockReturnValue('uploads/xss.js')
    get.mockResolvedValue(r2Object('application/javascript', 'alert(1)'))
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: UNSUPPORTED_IMAGE_TYPE,
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('returns 415 when R2 metadata has no content type', async () => {
    getRouterParam.mockReturnValue('uploads/mystery.bin')
    get.mockResolvedValue(r2Object(undefined))
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: UNSUPPORTED_IMAGE_TYPE,
      statusCode: 415,
    })
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('blocks non-upload keys before reading from R2', async () => {
    getRouterParam.mockReturnValue('private/test.png')
    const route = await loadRoute()

    await expect(route.default({} as never)).rejects.toMatchObject({
      message: 'Image not found',
      statusCode: 404,
    })
    expect(get).not.toHaveBeenCalled()
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })

  it('serves image/png with cache, ETag, nosniff, and inline disposition', async () => {
    getRouterParam.mockReturnValue('uploads/test.png')
    get.mockResolvedValue(r2Object('image/png', 'png body'))
    const route = await loadRoute()

    await expect(route.default({} as never)).resolves.toBe('png body')
    expect(setResponseHeaders).toHaveBeenCalledWith(expect.anything(), {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: 'etag',
    })
  })

  it('serves image/PNG; charset=x after normalizing the stored content type', async () => {
    getRouterParam.mockReturnValue('uploads/test.png')
    get.mockResolvedValue(r2Object('image/PNG; charset=x', 'png body'))
    const route = await loadRoute()

    await expect(route.default({} as never)).resolves.toBe('png body')
    expect(setResponseHeaders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      }),
    )
  })
})
